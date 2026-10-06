// engine.js
// Máquina de estados del Asistente de WhatsApp.
//
// El asistente NO agenda citas. Captura la solicitud (especialidad, paciente, día dentro de la
// ventana VET y bloque mañana/tarde), la registra como derivación en el servicio externo
// /api/ia/derivaciones, y la recepcionista concreta la hora desde el panel
// (POST /api/derivaciones/:id/reservar). Toda regla horaria se evalúa en America/Caracas.

const wa = require('./whatsapp');
const db = require('./db');
const sessions = require('./sessions');
const vet = require('./integrations/vetClient');
const derivaciones = require('./integrations/derivacionesClient');
const { obtenerCapacidades } = require('./integrations/capacidadesClient');
const { TZ, DESCRIPCION_HORARIO, estadoHorario } = require('./horarioLaboral');

const BOT_NOMBRE = process.env.BOT_NOMBRE || 'Asistente Virtual';
const CLINICA = process.env.CLINICA_NOMBRE || 'Clínica Echeverría';
// En horario laboral la solicitud también entra a la bandeja (es lo que la recepcionista abre
// para concretar la hora). Con DERIVAR_EN_HORARIO=false, en horario solo se registra como escalada.
const DERIVAR_EN_HORARIO = process.env.DERIVAR_EN_HORARIO !== 'false';
const MEDIODIA = 12; // separa el bloque 'manana' del 'tarde' (hora de Caracas)

const NOMBRE_ESPECIALIDAD = { eeg: 'Electroencefalografía', estetica: 'Medicina estética', pediatria: 'Pediatría', neurologia: 'Neurología' };
const ETIQUETA_DIA = { hoy: 'Hoy', manana: 'Mañana', pasado_manana: 'Pasado mañana' };
const ETIQUETA_BLOQUE = { manana: 'Mañana', tarde: 'Tarde' };
const PEDIR_NOMBRE = '¿A nombre de quién registro la solicitud? Escribe el nombre completo del paciente.';
const INSTRUCCIONES_EEG = 'Antes de continuar, ten en cuenta:\n• Dormir pocas horas la noche anterior\n• Evitar cafeína 12h antes\n• Cabello limpio, sin productos\n¿Continuamos?';

const fmtHora = new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const fmtHoraNum = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ });

// ---------------- Utilidades de formato ----------------

function tituloDia(dia) {
  const [, mes, d] = dia.date.split('-');
  const base = ETIQUETA_DIA[dia.label]
    || new Date(`${dia.date}T12:00:00Z`).toLocaleDateString('es-VE', { weekday: 'long', timeZone: 'UTC' });
  return `${base} ${d}/${mes}`.slice(0, 20); // límite de título de botón de WhatsApp
}

const hora = (iso) => fmtHora.format(new Date(iso));
const horaLocal = (iso) => Number(fmtHoraNum.format(new Date(iso)));

function fmt(fecha) {
  return new Date(fecha).toLocaleString('es-VE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

function agruparPorBloque(slots) {
  const bloques = { manana: [], tarde: [] };
  for (const s of slots) bloques[horaLocal(s.start) < MEDIODIA ? 'manana' : 'tarde'].push(s);
  return bloques;
}
const bloqueDe = (iso) => (horaLocal(iso) < MEDIODIA ? 'manana' : 'tarde');

/** 'automatico' solo con el módulo premium agendamiento_ia (contrato o prueba de 7 días vigente). */
async function modoAgendamiento() {
  const c = await obtenerCapacidades();
  return c.agendamientoAutomatico ? 'automatico' : 'derivacion';
}

function quien(d) {
  return d.esMenor ? d.nombrePaciente : `${d.nombrePaciente}`;
}

function notasDe(d) {
  const partes = [
    d.procedimiento,
    d.areaValoracion && `Área a valorar: ${d.areaValoracion}`,
    d.seguimiento && 'EEG de seguimiento solicitado tras Neurología',
  ].filter(Boolean);
  return partes.length ? partes.join(' · ').slice(0, 400) : null;
}

function resumenSolicitud(d) {
  const exacta = Boolean(d.slotElegido);
  return [
    exacta ? '📋 Resumen de tu cita:' : '📋 Resumen de tu solicitud:',
    `👤 Paciente: ${d.nombrePaciente}`,
    d.datosAcudiente ? `👪 Acudiente: ${d.datosAcudiente}` : null,
    `🏥 ${d.especialidadNombre} (${d.duracionMin} min)`,
    d.procedimiento ? `💉 ${d.procedimiento}` : null,
    exacta
      ? `📅 ${d.diaElegido.titulo} · ${hora(d.slotElegido.start)}`
      : `📅 ${d.diaElegido.titulo} · bloque de la ${ETIQUETA_BLOQUE[d.bloque].toLowerCase()}`,
    exacta ? `👨‍⚕️ ${d.doctorNombre}` : `👨‍⚕️ ${d.doctorNombre} (sujeto a confirmación)`,
  ].filter(Boolean).join('\n');
}

function resumenPlano(d) {
  return [d.especialidad, d.nombrePaciente, d.diaElegido?.date, d.bloque].filter(Boolean).join(' · ').slice(0, 250);
}

function avisoFueraDeHorario(h) {
  return h.dentroDeHorario
    ? ''
    : `\n\n🕘 Nuestro equipo humano atiende ${DESCRIPCION_HORARIO}. Igual puedo tomar tu solicitud ahora; la recepcionista la revisará ${h.proximaApertura}.`;
}

/** Marca la sesión para borrarse al final de procesarMensaje (evita que sessions.set la reviva). */
function terminar(sesion) {
  sesion.terminada = true;
}

// ---------------- Acciones ----------------

async function escalar(telefono, motivo) {
  await db.registrarEscalada(telefono, String(motivo).slice(0, 300));
  const h = estadoHorario();
  await wa.enviarTexto(telefono, h.dentroDeHorario
    ? 'Te comunico con nuestro equipo de recepción; en breve te escribirán por este chat 🙋'
    : `Registré tu caso para nuestro equipo de recepción. Como estás escribiendo fuera de horario (${DESCRIPCION_HORARIO}), te responderán ${h.proximaApertura} 🙏`);
}

/** Ofrece los días de la ventana VET (la regla de las 15:00 la aplica el módulo VET). */
async function ofrecerDias(telefono, sesion) {
  let disp;
  try {
    if (!sesion.datos.modo) sesion.datos.modo = await modoAgendamiento();
    disp = await vet.obtenerDisponibilidad(sesion.datos.especialidad);
  } catch (err) {
    console.error('[engine] Módulo VET no disponible:', err.code, err.message);
    await escalar(telefono, `Agenda no disponible (${err.code}) · ${resumenPlano(sesion.datos)}`);
    terminar(sesion);
    return;
  }

  const dias = disp.days.filter((d) => d.slots.length > 0).slice(0, 3);
  if (dias.length === 0) {
    await escalar(telefono, `Sin cupos en ventana VET · ${resumenPlano(sesion.datos)}`);
    terminar(sesion);
    return;
  }

  sesion.datos.especialidadNombre = NOMBRE_ESPECIALIDAD[sesion.datos.especialidad];
  sesion.datos.duracionMin = disp.durationMin;
  sesion.datos.diasOfrecidos = dias;
  await wa.enviarBotones(telefono,
    `¿Qué día prefieres para ${sesion.datos.especialidadNombre}? (duración: ${disp.durationMin} min)`,
    dias.map((d, i) => ({ id: `dia_${i}`, title: tituloDia(d) }))
  );
  sesion.paso = 'dia';
}

function mensajeEnHorario(d) {
  return `✅ Listo, recibí tu solicitud de ${d.especialidadNombre} para ${quien(d)} `
    + `(${d.diaElegido.titulo}, bloque de la ${ETIQUETA_BLOQUE[d.bloque].toLowerCase()}).\n\n`
    + 'Como soy un asistente de Inteligencia Artificial, no confirmo citas por mi cuenta: '
    + 'te transfiero con nuestra recepcionista, que te escribirá por este chat para concretar la hora exacta. 🙋‍♀️';
}

function mensajeFueraDeHorario(d, h) {
  return `📥 Recibí tu solicitud de ${d.especialidadNombre} para ${quien(d)} `
    + `(${d.diaElegido.titulo}, bloque de la ${ETIQUETA_BLOQUE[d.bloque].toLowerCase()}).\n\n`
    + `En este momento estamos fuera de nuestro horario de atención (${DESCRIPCION_HORARIO}). `
    + 'Tu solicitud quedó guardada en nuestra bandeja por orden de llegada y la recepcionista la revisará '
    + `el próximo día hábil (${h.proximaApertura}). Te escribiremos por este chat para confirmar la hora. 🙏`;
}

/**
 * Cierre de la captura. NUNCA crea la cita: la hora la concreta la recepcionista.
 * - Fuera de horario (18:01–08:59 y fines de semana): fila 'pendiente' en la bandeja.
 * - En horario (09:00–18:00): misma fila (salvo DERIVAR_EN_HORARIO=false) + mensaje de transferencia.
 * @returns {Promise<boolean>} true si la solicitud quedó registrada.
 */
async function derivarARecepcion(telefono, d) {
  const h = estadoHorario(); // America/Caracas, evaluado en el momento del cierre
  try {
    if (!h.dentroDeHorario || DERIVAR_EN_HORARIO) {
      const id = await derivaciones.registrarDerivacion({
        telefono,
        paciente: d.nombrePaciente,
        acudiente: d.datosAcudiente || null,
        especialidad: d.especialidad,
        bloque: d.bloque,
        fecha: d.diaElegido.date,
        doctorId: d.doctorId,
        notas: notasDe(d),
      });
      console.log(`[engine] Derivación ${id} registrada (${h.dentroDeHorario ? 'en horario' : 'fuera de horario'})`);
    } else {
      await db.registrarEscalada(telefono, `Solicitud de cita · ${resumenPlano(d)}`);
    }
  } catch (err) {
    console.error('[engine] No se pudo registrar la derivación:', err.code, err.message);
    await db.registrarEscalada(telefono, `Derivación NO registrada (${err.code}) · ${resumenPlano(d)}`)
      .catch((e) => console.error('[engine] Tampoco se pudo registrar la escalada:', e.message));
    await wa.enviarTexto(telefono, 'No pude registrar tu solicitud automáticamente 😕 Ya avisé a nuestro equipo y un asesor te contactará por este chat.');
    return false;
  }

  await wa.enviarTexto(telefono, h.dentroDeHorario ? mensajeEnHorario(d) : mensajeFueraDeHorario(d, h));
  return true;
}
/**
 * Modo premium: la IA confirma la cita. Resultados: 'ok' | 'reintentar' | 'error'.
 * Si el servidor ya no permite agendar (prueba vencida a mitad de la conversación),
 * la solicitud se deriva a recepción con el mismo día y bloque: el paciente no se pierde.
 */
async function agendarAutomatico(telefono, sesion) {
  const d = sesion.datos;
  const slot = d.slotElegido;
  try {
    await vet.reservar({
      especialidad: d.especialidad,
      doctorId: slot.doctorId,
      inicio: slot.start,
      paciente: {
        telefono,
        nombre: d.nombrePaciente,
        esMenor: Boolean(d.esMenor),
        nombreAcudiente: d.datosAcudiente || null,
      },
      notas: notasDe(d),
    });
  } catch (err) {
    if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_NOT_OFFERED') {
      await wa.enviarTexto(telefono, 'Ese horario acaba de ocuparse 😕 Te muestro los disponibles actualizados.');
      delete d.slotElegido;
      await ofrecerDias(telefono, sesion);
      return 'reintentar';
    }
    if (['MODULO_PREMIUM', 'BUSY_RETRY', 'INVALID_INPUT'].includes(err.code)) {
      // Respuestas en las que el servidor garantiza que NO creó la cita: derivar es seguro.
      if (err.code === 'MODULO_PREMIUM') console.warn('[engine] agendamiento_ia ya no está habilitado; se deriva a recepción');
      else console.error('[engine] Agendamiento automático rechazado:', err.code, err.message);
      d.modo = 'derivacion';
      d.bloque = bloqueDe(slot.start);
      delete d.slotElegido;
      return (await derivarARecepcion(telefono, d)) ? 'ok' : 'error';
    }
    // Sin respuesta del servidor (timeout, red): la cita PUDO crearse. No se deriva para no duplicarla.
    console.error('[engine] Resultado incierto del agendamiento:', err.code, err.message);
    await escalar(telefono, `Agendamiento IA con resultado incierto (${err.code}) · ${resumenPlano(d)} · ${slot.start}`);
    return 'error';
  }

  await wa.enviarTexto(telefono,
    `✅ ¡Cita agendada!\n📅 ${d.diaElegido.titulo} · ${hora(slot.start)}\n👨‍⚕️ ${slot.doctorName}\n🏥 ${d.especialidadNombre}\n\n`
    + 'Te enviaremos un recordatorio antes de la cita. Si necesitas cambiarla, escribe "asesor".');
  return 'ok';
}
// ---------------- Máquina de estados ----------------

async function procesarMensaje(telefono, texto, idInteractivo) {
  const sesion = sessions.get(telefono);
  const entrada = (idInteractivo || texto || '').trim();
  const entradaLower = entrada.toLowerCase();

  if (['asesor', 'humano', 'ayuda'].includes(entradaLower)) {
    await escalar(telefono, 'Solicitud explícita del paciente');
    sessions.reset(telefono);
    return;
  }
  if (entradaLower === 'cancelar' && sesion.paso !== 'inicio') {
    sessions.reset(telefono);
    await wa.enviarTexto(telefono, 'Cancelé el proceso actual. Escribe "hola" para empezar de nuevo cuando quieras.');
    return;
  }

  switch (sesion.paso) {
        case 'inicio': {
      const h = estadoHorario();
      sesion.datos.modo = await modoAgendamiento();
      const automatico = sesion.datos.modo === 'automatico';
      const queHago = automatico
        ? 'puedo agendar tu cita directamente, a cualquier hora'
        : 'tomo tu solicitud y la paso a nuestro equipo de recepción, que confirma la cita';
      await wa.enviarLista(telefono,
        `👋 Hola, bienvenido/a a ${CLINICA}. Soy ${BOT_NOMBRE}, un asistente de Inteligencia Artificial: `
        + `${queHago}.${automatico ? '' : avisoFueraDeHorario(h)}\n\n¿Qué deseas hacer hoy?`,
        'Ver opciones', [
          { id: 'menu_agendar', title: automatico ? 'Agendar cita' : 'Solicitar cita' },
          { id: 'menu_ver_cita', title: 'Ver/cancelar mi cita' },
          { id: 'menu_asesor', title: 'Hablar con un asesor' },
        ]);
      sesion.paso = 'menu_principal';
      break;
    }

    case 'menu_principal':
      if (entrada === 'menu_agendar') {
        await wa.enviarLista(telefono, '¿Qué especialidad necesitas?', 'Ver especialidades', [
          { id: 'esp_eeg', title: 'Electroencefalografía' },
          { id: 'esp_estetica', title: 'Medicina estética' },
          { id: 'esp_pediatria', title: 'Pediatría' },
          { id: 'esp_neurologia', title: 'Neurología' },
        ]);
        sesion.paso = 'especialidad';
      } else if (entrada === 'menu_ver_cita') {
        await wa.enviarTexto(telefono, 'Escribe el número de teléfono con el que agendaste (o escribe "este" para usar este número).');
        sesion.paso = 'ver_cita_telefono';
      } else if (entrada === 'menu_asesor') {
        await escalar(telefono, 'Solicitud desde menú principal');
        terminar(sesion);
      } else {
        await wa.enviarTexto(telefono, 'No entendí esa opción, por favor selecciona una de la lista. 🙏');
      }
      break;

    // ---------------- Ver / cancelar cita ----------------
    case 'ver_cita_telefono': {
      const tel = entradaLower === 'este' ? telefono : entrada;
      const citas = await db.citasFuturasPorTelefono(tel);
      if (citas.length === 0) {
        await wa.enviarTexto(telefono, 'No encontré citas próximas con ese número.');
        terminar(sesion);
        break;
      }
      const cita = citas[0];
      sesion.datos.citaId = cita.id;
      await wa.enviarBotones(telefono,
        `Encontré esta cita:\n📅 ${fmt(cita.fecha_hora_inicio)}\n👨‍⚕️ ${cita.doctor_nombre}\n🏥 ${cita.especialidad_nombre}`,
        [{ id: 'cita_cancelar', title: 'Cancelar' }, { id: 'cita_dejar', title: 'Dejarla así' }]
      );
      sesion.paso = 'ver_cita_accion';
      break;
    }
    case 'ver_cita_accion':
      if (entrada === 'cita_cancelar') {
        await db.cancelarCita(sesion.datos.citaId);
        await wa.enviarTexto(telefono, 'Tu cita fue cancelada. El horario quedó libre para otro paciente.');
      } else {
        await wa.enviarTexto(telefono, 'Perfecto, nos vemos en tu cita 🙌');
      }
      terminar(sesion);
      break;

    // ---------------- Especialidad y datos clínicos ----------------
    case 'especialidad': {
      const mapa = { esp_eeg: 'eeg', esp_estetica: 'estetica', esp_pediatria: 'pediatria', esp_neurologia: 'neurologia' };
      const clave = mapa[entrada];
      if (!clave) { await wa.enviarTexto(telefono, 'Por favor selecciona una especialidad de la lista.'); break; }
      sesion.datos.especialidad = clave;

      if (clave === 'eeg') {
        await wa.enviarBotones(telefono, `Perfecto. ${INSTRUCCIONES_EEG}`,
          [{ id: 'eeg_si', title: 'Sí, continuar' }, { id: 'eeg_no', title: 'No, más tarde' }]);
        sesion.paso = 'eeg_confirmar_instrucciones';
      } else if (clave === 'estetica') {
        await wa.enviarLista(telefono, '¿Qué procedimiento te interesa?', 'Ver opciones', [
          { id: 'proc_botox', title: 'Botox' },
          { id: 'proc_limpieza', title: 'Limpieza facial' },
          { id: 'proc_valoracion', title: 'Consulta valorativa' },
        ]);
        sesion.paso = 'estetica_procedimiento';
      } else if (clave === 'pediatria') {
        await wa.enviarBotones(telefono, '¿Es para ti o para un menor de edad?', [
          { id: 'ped_menor', title: 'Para un menor' }, { id: 'ped_adulto', title: 'Para mí' },
        ]);
        sesion.paso = 'pediatria_quien';
      } else {
        await wa.enviarTexto(telefono, PEDIR_NOMBRE);
        sesion.paso = 'pedir_nombre';
      }
      break;
    }

    case 'eeg_confirmar_instrucciones':
      if (entrada !== 'eeg_si') {
        await wa.enviarTexto(telefono, 'Sin problema, aquí estaré cuando quieras solicitar tu cita.');
        terminar(sesion);
      } else if (sesion.datos.seguimiento && sesion.datos.nombrePaciente) {
        await ofrecerDias(telefono, sesion); // seguimiento tras Neurología: ya tenemos el nombre
      } else {
        await wa.enviarTexto(telefono, PEDIR_NOMBRE);
        sesion.paso = 'pedir_nombre';
      }
      break;

    case 'estetica_procedimiento': {
      const mapa = { proc_botox: 'Botox', proc_limpieza: 'Limpieza facial', proc_valoracion: 'Consulta valorativa' };
      const nombre = mapa[entrada];
      if (!nombre) { await wa.enviarTexto(telefono, 'Selecciona una opción de la lista.'); break; }
      sesion.datos.procedimiento = nombre;
      if (entrada === 'proc_valoracion') {
        await wa.enviarTexto(telefono, '¿Qué área te gustaría valorar en la consulta? (rostro, cicatrices, manchas, etc.)');
        sesion.paso = 'estetica_area';
      } else {
        await wa.enviarTexto(telefono, PEDIR_NOMBRE);
        sesion.paso = 'pedir_nombre';
      }
      break;
    }
    case 'estetica_area':
      sesion.datos.areaValoracion = entrada.slice(0, 200);
      await wa.enviarTexto(telefono, PEDIR_NOMBRE);
      sesion.paso = 'pedir_nombre';
      break;

    case 'pediatria_quien':
      if (entrada === 'ped_menor') {
        await wa.enviarTexto(telefono, 'Indícame el nombre del niño/a y su fecha de nacimiento.');
        sesion.paso = 'pediatria_datos_nino';
      } else {
        await wa.enviarTexto(telefono, PEDIR_NOMBRE);
        sesion.paso = 'pedir_nombre';
      }
      break;
    case 'pediatria_datos_nino':
      sesion.datos.nombrePaciente = entrada.slice(0, 150);
      sesion.datos.esMenor = true;
      await wa.enviarTexto(telefono, 'Gracias. Ahora el nombre y teléfono del acudiente responsable.');
      sesion.paso = 'pediatria_datos_acudiente';
      break;
    case 'pediatria_datos_acudiente':
      sesion.datos.datosAcudiente = entrada.slice(0, 150);
      await ofrecerDias(telefono, sesion);
      break;

    case 'pedir_nombre':
      if (entrada.length < 3) { await wa.enviarTexto(telefono, 'Escribe el nombre completo del paciente, por favor.'); break; }
      sesion.datos.nombrePaciente = entrada.slice(0, 150);
      await ofrecerDias(telefono, sesion);
      break;

    // ---------------- Día (ventana VET) ----------------
    case 'dia': {
      const dia = sesion.datos.diasOfrecidos?.[parseInt(entrada.replace('dia_', ''), 10)];
      if (!dia) { await wa.enviarTexto(telefono, 'Selecciona uno de los días de la lista.'); break; }

      const bloques = agruparPorBloque(dia.slots);
      const opciones = ['manana', 'tarde'].filter((b) => bloques[b].length > 0);
      sesion.datos.diaElegido = { date: dia.date, titulo: tituloDia(dia) };
      sesion.datos.bloquesOfrecidos = bloques;

      const rangos = opciones.map((b) =>
        `${b === 'manana' ? '🌅' : '🌇'} ${ETIQUETA_BLOQUE[b]}: ${hora(bloques[b][0].start)} a ${hora(bloques[b].at(-1).end)}`);
      const cierre = sesion.datos.modo === 'automatico'
        ? 'Luego te muestro las horas exactas disponibles.'
        : 'La recepcionista te asignará la hora exacta dentro del bloque.';
      await wa.enviarBotones(telefono,
        `¿Qué bloque prefieres el ${tituloDia(dia)}?\n${rangos.join('\n')}\n\n${cierre}`,
        [...opciones.map((b) => ({ id: `bloque_${b}`, title: ETIQUETA_BLOQUE[b] })), { id: 'bloque_otro_dia', title: 'Otro día' }]
      );
      sesion.paso = 'bloque';
      break;
    }

    // ---------------- Bloque mañana / tarde ----------------
        // ---------------- Bloque mañana / tarde ----------------
    case 'bloque': {
      if (entrada === 'bloque_otro_dia') { await ofrecerDias(telefono, sesion); break; }
      const bloque = { bloque_manana: 'manana', bloque_tarde: 'tarde' }[entrada];
      const slots = bloque ? sesion.datos.bloquesOfrecidos?.[bloque] : null;
      if (!slots || slots.length === 0) { await wa.enviarTexto(telefono, 'Selecciona uno de los bloques disponibles.'); break; }
      sesion.datos.bloque = bloque;

      if (sesion.datos.modo === 'automatico') {
        const lista = slots.slice(0, 10); // máx. 10 filas por lista de WhatsApp
        sesion.datos.slotsOfrecidos = lista;
        await wa.enviarLista(telefono,
          `Horarios disponibles — ${sesion.datos.diaElegido.titulo}, ${ETIQUETA_BLOQUE[bloque].toLowerCase()}:`,
          'Ver horarios',
          lista.map((s, i) => ({ id: `slot_${i}`, title: `${hora(s.start)} · ${s.doctorName}`.slice(0, 24) })));
        sesion.paso = 'horario';
        break;
      }

      sesion.datos.doctorId = slots[0].doctorId;       // doctor sugerido; recepción puede reasignarlo
      sesion.datos.doctorNombre = slots[0].doctorName;
      await wa.enviarBotones(telefono, `${resumenSolicitud(sesion.datos)}\n\n¿Envío la solicitud a recepción?`, [
        { id: 'conf_si', title: 'Enviar solicitud' },
        { id: 'conf_cambiar', title: 'Cambiar día' },
      ]);
      sesion.paso = 'confirmar';
      break;
    }

    // ---------------- Hora exacta (solo módulo agendamiento_ia) ----------------
    case 'horario': {
      const slot = sesion.datos.slotsOfrecidos?.[parseInt(entrada.replace('slot_', ''), 10)];
      if (!slot) { await wa.enviarTexto(telefono, 'Selecciona uno de los horarios de la lista.'); break; }
      sesion.datos.slotElegido = slot;
      sesion.datos.doctorId = slot.doctorId;
      sesion.datos.doctorNombre = slot.doctorName;
      await wa.enviarBotones(telefono, `${resumenSolicitud(sesion.datos)}\n\n¿Confirmo la cita?`, [
        { id: 'conf_si', title: 'Confirmar cita' },
        { id: 'conf_cambiar', title: 'Cambiar horario' },
      ]);
      sesion.paso = 'confirmar';
      break;
    }

    // ---------------- Cierre: agenda (premium) o deriva a recepción (base) ----------------
    case 'confirmar': {
      if (entrada === 'conf_cambiar') { delete sesion.datos.slotElegido; await ofrecerDias(telefono, sesion); break; }
      if (entrada !== 'conf_si') { await wa.enviarTexto(telefono, 'Usa los botones para confirmar o cambiar.'); break; }

      const resultado = sesion.datos.modo === 'automatico'
        ? await agendarAutomatico(telefono, sesion)
        : ((await derivarARecepcion(telefono, sesion.datos)) ? 'ok' : 'error');

      if (resultado === 'reintentar') break; // ya se ofrecieron días actualizados
      if (resultado === 'ok' && sesion.datos.especialidad === 'neurologia' && !sesion.datos.seguimiento) {
        await wa.enviarBotones(telefono, '¿Deseas también un electroencefalograma de seguimiento?',
          [{ id: 'eeg_seguimiento_si', title: 'Sí, también EEG' }, { id: 'eeg_seguimiento_no', title: 'No, gracias' }]);
        sesion.paso = 'neuro_seguimiento';
      } else {
        terminar(sesion);
      }
      break;
    }

    case 'neuro_seguimiento':
      if (entrada === 'eeg_seguimiento_si') {
        const { nombrePaciente, esMenor, datosAcudiente, modo } = sesion.datos;
        sesion.datos = { nombrePaciente, esMenor, datosAcudiente, modo, especialidad: 'eeg', seguimiento: true };
        await wa.enviarBotones(telefono, INSTRUCCIONES_EEG,
          [{ id: 'eeg_si', title: 'Sí, continuar' }, { id: 'eeg_no', title: 'No, más tarde' }]);
        sesion.paso = 'eeg_confirmar_instrucciones';
      } else {
        await wa.enviarTexto(telefono, '¡Gracias por escribirnos! 🙌');
        terminar(sesion);
      }
      break;

    default:
      sessions.reset(telefono);
      await procesarMensaje(telefono, texto, idInteractivo);
      return;
  }

  if (sesion.terminada) sessions.reset(telefono);
  else sessions.set(telefono, sesion);
}

module.exports = { procesarMensaje };