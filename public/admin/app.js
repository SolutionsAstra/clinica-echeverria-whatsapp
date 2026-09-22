const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const ESP_NOMBRE = { eeg:'EEG', estetica:'Estética', pediatria:'Pediatría', neurologia:'Neurología' };
let usuarioActual = null;

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2400);
}
async function api(path, opts={}){
  const res=await fetch('/api'+path, { headers:{'Content-Type':'application/json'}, ...opts });
  if(res.status===401){ window.location.href='login.html'; throw new Error('No autenticado'); }
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    toast(body.error || ('Error: '+res.status));
    throw new Error('API error '+res.status);
  }
  return res.json();
}

// ---- Sesión ----
async function iniciar(){
  try{
    usuarioActual = await api('/auth/me');
  } catch(e){ return; } // api() ya redirige a login.html en 401

  document.getElementById('user-box').innerHTML = `
    <div class="u-name">${usuarioActual.nombre}</div>
    <div class="u-rol">${usuarioActual.rol}</div>
    <button id="btn-logout">Cerrar sesión</button>
  `;
  document.getElementById('btn-logout').addEventListener('click', async ()=>{
    await api('/auth/logout', { method:'POST' });
    window.location.href='login.html';
  });

  // Oculta del menú lo que el rol de este usuario no puede usar
  document.querySelectorAll('.nav-item[data-role]').forEach(btn=>{
    const permitidos = btn.dataset.role.split(',');
    if(!permitidos.includes(usuarioActual.rol)) btn.remove();
  });

  // El botón de generar reporte solo aplica a dirección (la pestaña ya está oculta para los demás roles,
  // esto es un refuerzo por si acceden directo a la vista)
  if(usuarioActual.rol !== 'direccion'){
    document.getElementById('btn-generar-reporte')?.remove();
  }

  cargarResumen();
}

// ---- Navegación ----
document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    cargarVista(btn.dataset.view);
  });
});

function cargarVista(v){
  if(v==='resumen') cargarResumen();
  if(v==='citas') cargarCitas();
  if(v==='doctores') cargarDoctores();
  if(v==='reportes') cargarReportes();
  if(v==='escaladas') cargarEscaladas();
  if(v==='usuarios') cargarUsuarios();
}

// ---- Resumen ----
async function cargarResumen(){
  const m = await api('/metricas');
  const filas = [
    `<div class="metric"><div class="num">${m.total_citas}</div><div class="label">Citas totales${usuarioActual.rol==='doctor' ? ' (tu agenda)' : ' registradas'}</div></div>`,
    `<div class="metric"><div class="num">${m.confirmadas}</div><div class="label">Citas confirmadas activas</div></div>`,
    `<div class="metric"><div class="num">${m.tasa_no_show}%</div><div class="label">Tasa de inasistencia (no-show)</div></div>`,
  ];
  if(m.conversaciones_escaladas !== null){
    filas.push(`<div class="metric"><div class="num">${m.conversaciones_escaladas}</div><div class="label">Conversaciones escaladas a un asesor</div></div>`);
  }
  document.getElementById('metric-grid').innerHTML = filas.join('');
}

// ---- Citas ----
function pillEstado(estado){
  if(estado==='confirmada') return '<span class="pill ok">Confirmada</span>';
  if(estado==='no_show') return '<span class="pill warn">No-show</span>';
  return '<span class="pill muted">Cancelada</span>';
}
async function cargarCitas(){
  const estado = document.getElementById('f-estado').value;
  const especialidad = document.getElementById('f-especialidad').value;
  const params = new URLSearchParams();
  if(estado) params.set('estado', estado);
  if(especialidad) params.set('especialidad', especialidad);
  const citas = await api('/citas?'+params.toString());

  const tbody = document.querySelector('#tbl-citas tbody');
  document.getElementById('citas-empty').hidden = citas.length !== 0;
  tbody.innerHTML = citas.map(c => `
    <tr data-id="${c.id}">
      <td>${c.paciente_nombre}</td>
      <td>${c.paciente_telefono}</td>
      <td>${c.especialidad_nombre}</td>
      <td>${c.doctor_nombre}</td>
      <td>${new Date(c.fecha_hora_inicio).toLocaleString('es-VE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
      <td>${pillEstado(c.estado)}</td>
      <td class="row-actions">
        ${c.estado==='confirmada' ? `
          <button data-action="cancelar">Cancelar</button>
          <button data-action="no-show">No-show</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const action = e.target.dataset.action;
      await api(`/citas/${id}/${action}`, { method:'POST' });
      toast(action==='cancelar' ? 'Cita cancelada.' : 'Marcada como no-show.');
      cargarCitas();
    });
  });
}
document.getElementById('f-estado').addEventListener('change', cargarCitas);
document.getElementById('f-especialidad').addEventListener('change', cargarCitas);

// ---- Doctores ----
async function cargarDoctores(){
  const doctores = await api('/doctores');
  const puedeEditar = usuarioActual.rol === 'direccion';
  const grid = document.getElementById('doctores-grid');
  grid.innerHTML = doctores.map(d => `
    <div class="doc-card" data-id="${d.id}">
      <h3>${d.nombre}</h3>
      <div class="esp">${(d.especialidades||[]).map(e=>ESP_NOMBRE[e]||e).join(', ')} · ${d.email}</div>
      <label>Días de atención</label>
      <div class="dias-row">
        ${DIAS.map((nombre,i)=>`<div class="dia-chip ${d.horario?.dias?.includes(i)?'on':''} ${puedeEditar?'':'disabled'}" data-dia="${i}">${nombre}</div>`).join('')}
      </div>
      <label>Hora inicio</label>
      <input type="time" class="hora-inicio" value="${d.horario?.hora_inicio||'08:00'}" ${puedeEditar?'':'disabled'}>
      <label>Hora fin</label>
      <input type="time" class="hora-fin" value="${d.horario?.hora_fin||'16:00'}" ${puedeEditar?'':'disabled'}>
      ${puedeEditar ? '<button class="btn save">Guardar horario</button>' : ''}
    </div>
  `).join('');

  if(!puedeEditar) return;

  grid.querySelectorAll('.doc-card').forEach(card=>{
    card.querySelectorAll('.dia-chip').forEach(chip=>{
      chip.addEventListener('click',()=>chip.classList.toggle('on'));
    });
    card.querySelector('.save').addEventListener('click', async ()=>{
      const id = card.dataset.id;
      const dias = [...card.querySelectorAll('.dia-chip.on')].map(c=>Number(c.dataset.dia));
      const hora_inicio = card.querySelector('.hora-inicio').value;
      const hora_fin = card.querySelector('.hora-fin').value;
      await api(`/doctores/${id}/horario`, { method:'PUT', body: JSON.stringify({ dias, hora_inicio, hora_fin }) });
      toast('Horario actualizado.');
    });
  });
}

// ---- Reportes ----
async function cargarReportes(){
  const reportes = await api('/reportes');
  const tbody = document.getElementById('tbl-reportes');
  document.getElementById('reportes-empty').hidden = reportes.length !== 0;
  tbody.innerHTML = reportes.map(r => `
    <tr>
      <td>${r.doctor_nombre}</td>
      <td>${new Date(r.fecha_generacion).toLocaleString('es-VE')}</td>
      <td>${r.estado_envio==='enviado' ? '<span class="pill ok">Enviado</span>' : '<span class="pill warn">Fallido</span>'}</td>
    </tr>
  `).join('');
}
document.getElementById('btn-generar-reporte')?.addEventListener('click', async (e)=>{
  e.target.disabled = true; e.target.textContent = 'Generando…';
  try{
    await api('/reportes/generar-ahora', { method:'POST' });
    toast('Reporte generado y enviado.');
    cargarReportes();
  } finally {
    e.target.disabled = false; e.target.textContent = 'Generar y enviar ahora';
  }
});

// ---- Escaladas ----
async function cargarEscaladas(){
  const lista = await api('/escaladas');
  const tbody = document.getElementById('tbl-escaladas');
  document.getElementById('escaladas-empty').hidden = lista.length !== 0;
  tbody.innerHTML = lista.map(e => `
    <tr><td>${e.telefono}</td><td>${e.motivo}</td><td>${new Date(e.fecha).toLocaleString('es-VE')}</td></tr>
  `).join('');
}

// ---- Usuarios ----
const ROL_NOMBRE = { recepcion:'Recepción', doctor:'Doctor', direccion:'Dirección' };
let doctoresParaSelect = [];

async function poblarSelectDoctor(select){
  if(doctoresParaSelect.length === 0) doctoresParaSelect = await api('/doctores');
  select.innerHTML = doctoresParaSelect.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
}

document.getElementById('nu-rol').addEventListener('change', async (e)=>{
  const selDoctor = document.getElementById('nu-doctor');
  if(e.target.value === 'doctor'){
    await poblarSelectDoctor(selDoctor);
    selDoctor.hidden = false;
  } else {
    selDoctor.hidden = true;
  }
});

document.getElementById('form-nuevo-usuario').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const nombre = document.getElementById('nu-nombre').value.trim();
  const email = document.getElementById('nu-email').value.trim();
  const password = document.getElementById('nu-password').value;
  const rol = document.getElementById('nu-rol').value;
  const doctor_id = document.getElementById('nu-doctor').value;

  try{
    await api('/usuarios', { method:'POST', body: JSON.stringify({ nombre, email, password, rol, doctor_id: rol==='doctor'?doctor_id:null }) });
    toast('Usuario creado.');
    e.target.reset();
    document.getElementById('nu-doctor').hidden = true;
    cargarUsuarios();
  } catch(err){ /* api() ya mostró el toast con el mensaje de error del servidor */ }
});

async function cargarUsuarios(){
  const usuarios = await api('/usuarios');
  await poblarSelectDoctor({ innerHTML:'' }); // precarga doctoresParaSelect en cache, sin tocar el DOM
  const tbody = document.getElementById('tbl-usuarios');

  tbody.innerHTML = usuarios.map(u => `
    <tr data-id="${u.id}">
      <td>${u.nombre}</td>
      <td>${u.email}</td>
      <td>
        <select class="u-rol">
          ${Object.entries(ROL_NOMBRE).map(([v,n])=>`<option value="${v}" ${u.rol===v?'selected':''}>${n}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="u-doctor" ${u.rol==='doctor'?'':'hidden'}>
          ${doctoresParaSelect.map(d=>`<option value="${d.id}" ${u.doctor_id===d.id?'selected':''}>${d.nombre}</option>`).join('')}
        </select>
        ${u.rol!=='doctor' ? '—' : ''}
      </td>
      <td>${u.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill inactive">Inactivo</span>'}</td>
      <td class="row-actions">
        <button data-action="guardar">Guardar</button>
        <button data-action="toggle-activo">${u.activo?'Desactivar':'Activar'}</button>
        <button data-action="reset-clave">Restablecer clave</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.u-rol').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const doctorSel = sel.closest('tr').querySelector('.u-doctor');
      doctorSel.hidden = sel.value !== 'doctor';
    });
  });

  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const action = e.target.dataset.action;

      if(action === 'guardar' || action === 'toggle-activo'){
        const rol = tr.querySelector('.u-rol').value;
        const doctorSel = tr.querySelector('.u-doctor');
        const doctor_id = rol==='doctor' ? doctorSel.value : null;
        const activoActual = tr.querySelector('.pill').classList.contains('ok');
        const nuevoActivo = action==='toggle-activo' ? !activoActual : activoActual;
        const nombre = tr.children[0].textContent;

        try{
          await api(`/usuarios/${id}`, { method:'PUT', body: JSON.stringify({ nombre, rol, doctor_id, activo: nuevoActivo }) });
          toast('Usuario actualizado.');
          cargarUsuarios();
        } catch(err){ /* toast ya mostrado */ }
      }

      if(action === 'reset-clave'){
        const nueva = prompt('Nueva contraseña para este usuario (mínimo 6 caracteres):');
        if(!nueva) return;
        await api(`/usuarios/${id}/reset-password`, { method:'POST', body: JSON.stringify({ password: nueva }) });
        toast('Contraseña actualizada.');
      }
    });
  });
}

iniciar();
