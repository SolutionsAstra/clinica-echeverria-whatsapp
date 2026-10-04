// routes/adminApi.js
// Todas las rutas requieren sesión (aplicado en server.js con requireLogin).
// Acá además se restringe por rol: recepcion, doctor, direccion.

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { generarYEnviarReporte } = require('../jobs/reportJob');
const wa = require('../whatsapp');
const { responderErrorPlan } = require('../modules/plan');

const TZ_NEGOCIO = 'America/Caracas';

// Plan comercial de Astra (src/modules/plan). server.js lo inyecta: app.locals.plan = planModule
function plan(req) {
  const modulo = req.app.locals.plan;
  if (!modulo) throw new Error('[adminApi] Falta app.locals.plan (ver server.js)');
  return modulo;
}
// 403 { error: 'MODULO_PREMIUM', mensaje, modulo } si el módulo no está contratado ni en prueba.
const requireModulo = (nombre) => (req, res, next) => plan(req).requireModulo(nombre)(req, res, next);

// Doctor: solo ve sus propias citas/métricas. Fuerza el filtro sin importar lo que mande el query string.
function doctorIdEfectivo(req) {
  return req.session.usuario.rol === 'doctor' ? req.session.usuario.doctor_id : (req.query.doctorId || req.body.doctorId);
}

// ---------------- Métricas ----------------
router.get('/metricas', async (req, res, next) => {
  try {
    const doctorId = doctorIdEfectivo(req);
    res.json(await db.metricas(doctorId ? Number(doctorId) : null));
  } catch (err) { next(err); }
});

// ---------------- Citas ----------------
router.get('/citas', async (req, res, next) => {
  try {
    const { estado, especialidad } = req.query;
    const doctorId = doctorIdEfectivo(req);
    const citas = await db.listarCitas({ estado, doctorId, especialidadCodigo: especialidad });
    res.json(citas);
  } catch (err) { next(err); }
});

// Confirma que, si quien pide es 'doctor', la cita sea suya antes de dejarlo modificarla.
async function verificarPropiedadSiEsDoctor(req, res, citaId) {
  if (req.session.usuario.rol !== 'doctor') return true;
  const citas = await db.listarCitas({ doctorId: req.session.usuario.doctor_id });
  const esSuya = citas.some(c => c.id === citaId);
  if (!esSuya) { res.status(403).json({ error: 'Esa cita no pertenece a tu agenda' }); return false; }
  return true;
}

router.post('/citas/:id/cancelar', requireRole('recepcion', 'direccion', 'doctor'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await verificarPropiedadSiEsDoctor(req, res, id))) return;
    await db.cancelarCita(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/citas/:id/no-show', requireRole('recepcion', 'direccion', 'doctor'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await verificarPropiedadSiEsDoctor(req, res, id))) return;
    await db.marcarNoShow(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Recordatorio manual (reemplaza al automático de 24 h). Premium: Notificaciones Avanzadas.
// Solo WhatsApp: la tabla pacientes no guarda correo, así que el canal de correo queda pendiente.
router.post('/citas/:id/recordatorio-manual',
  requireRole('recepcion', 'direccion'),
  requireModulo('notificaciones_avanzadas'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cita = (await db.listarCitas({ estado: 'confirmada' })).find(c => c.id === id);
      if (!cita) return res.status(404).json({ error: 'NOT_FOUND', mensaje: 'La cita no existe o ya no está confirmada' });
      const cuando = new Date(cita.fecha_hora_inicio).toLocaleString('es-VE', {
        timeZone: TZ_NEGOCIO, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      });
      await wa.enviarTexto(cita.paciente_telefono,
        `Recordatorio: tienes cita de ${cita.especialidad_nombre} con ${cita.doctor_nombre} el ${cuando}. Si necesitas cambiarla, escríbenos por aquí.`);
      res.json({ ok: true, canales: ['whatsapp'] });
    } catch (err) { next(err); }
  });

router.post('/citas/:id/reprogramar', requireRole('recepcion', 'direccion'), async (req, res, next) => {
  try {
    const { nueva_fecha_hora_inicio, nueva_fecha_hora_fin } = req.body;
    if (!nueva_fecha_hora_inicio || !nueva_fecha_hora_fin) return res.status(400).json({ error: 'Faltan fechas nuevas' });
    await db.reprogramarCita(Number(req.params.id), nueva_fecha_hora_inicio, nueva_fecha_hora_fin);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------- Doctores y horarios ----------------
router.get('/doctores', async (req, res, next) => {
  try {
    const doctores = await db.getDoctores();
    const conHorario = await Promise.all(doctores.map(async d => ({ ...d, horario: await db.getHorarioDoctor(d.id) })));
    res.json(conHorario);
  } catch (err) { next(err); }
});

router.put('/doctores/:id/horario', requireRole('direccion'), async (req, res, next) => {
  try {
    const { dias, hora_inicio, hora_fin } = req.body;
    const horario = await db.actualizarHorarioDoctor(Number(req.params.id), { dias, hora_inicio, hora_fin });
    res.json({ ok: true, horario });
  } catch (err) { next(err); }
});

// ---------------- Reportes (solo dirección, módulo premium) ----------------
router.get('/reportes', requireRole('direccion'), requireModulo('reportes'), async (req, res, next) => {
  try { res.json(await db.listarReportes()); } catch (err) { next(err); }
});

router.post('/reportes/generar-ahora', requireRole('direccion'), requireModulo('reportes'), async (req, res, next) => {
  try { await generarYEnviarReporte(); res.json({ ok: true }); }
  catch (err) { next(err); }
});

// ---------------- Escaladas (recepción y dirección) ----------------
router.get('/escaladas', requireRole('recepcion', 'direccion'), async (req, res, next) => {
  try { res.json(await db.listarEscaladas()); } catch (err) { next(err); }
});

// ---------------- Usuarios del panel (solo dirección) ----------------
router.get('/usuarios', requireRole('direccion'), async (req, res, next) => {
  try { res.json(await db.listarUsuarios()); } catch (err) { next(err); }
});

router.post('/usuarios', requireRole('direccion'), async (req, res, next) => {
  try {
    const { nombre, email, password, rol, doctor_id } = req.body;
    if (!nombre || !email || !password || !rol) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    if (!['recepcion', 'doctor', 'direccion'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (rol === 'doctor' && !doctor_id) return res.status(400).json({ error: 'Selecciona a qué doctor corresponde esta cuenta' });

    // Tope de operadores del plan. El trigger de la BD es la garantía final ante altas simultáneas.
    await plan(req).service.exigirCupoOperador();

    const password_hash = await bcrypt.hash(password, 10);
    const nuevo = await db.crearUsuario({
      nombre, email: email.toLowerCase().trim(), password_hash, rol,
      doctor_id: rol === 'doctor' ? Number(doctor_id) : null
    });
    res.json({ ok: true, id: nuevo.id });
  } catch (err) {
    if (responderErrorPlan(err, res)) return;
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Ese correo ya está registrado' });
    next(err);
  }
});

router.put('/usuarios/:id', requireRole('direccion'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { nombre, rol, doctor_id, activo } = req.body;
    if (!['recepcion', 'doctor', 'direccion'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (rol === 'doctor' && !doctor_id) return res.status(400).json({ error: 'Selecciona a qué doctor corresponde esta cuenta' });
    if (id === req.session.usuario.id && activo === false) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    if (activo === true) {
      // Reactivar una cuenta consume cupo igual que crearla.
      const actual = (await db.listarUsuarios()).find(u => u.id === id);
      if (actual && !actual.activo) await plan(req).service.exigirCupoOperador();
    }
    await db.actualizarUsuario(id, { nombre, rol, doctor_id: rol === 'doctor' ? Number(doctor_id) : null, activo });
    res.json({ ok: true });
  } catch (err) {
    if (responderErrorPlan(err, res)) return;
    next(err);
  }
});

router.post('/usuarios/:id/reset-password', requireRole('direccion'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const password_hash = await bcrypt.hash(password, 10);
    await db.cambiarPasswordUsuario(Number(req.params.id), password_hash);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
