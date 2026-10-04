// jobs/reminders.js
// Cron cada 10 minutos: avisa al paciente 2 h antes de su cita.
//
// El recordatorio automático de 24 h se retiró (2026-10-04). Su reemplazo es el botón
// "Lanzar Recordatorio Manual WhatsApp / Correo" del panel, que pertenece al Módulo de
// Notificaciones Avanzadas de Astra (POST /api/citas/:id/recordatorio-manual).
// La notificación inmediata al reservar sigue igual (módulo de derivaciones y engine.js).

const cron = require('node-cron');
const db = require('../db');
const wa = require('../whatsapp');

const VENTANA_MIN = 10;

function dentroDeVentana(fechaCita, horasAntes) {
  const objetivo = new Date(fechaCita).getTime() - horasAntes * 3600000;
  const ahora = Date.now();
  return Math.abs(ahora - objetivo) <= VENTANA_MIN * 60000;
}

async function revisarRecordatorios() {
  const citas = await db.citasParaRecordatorios();

  for (const cita of citas) {
    if (!cita.recordatorio_2h_enviado && dentroDeVentana(cita.fecha_hora_inicio, 2)) {
      await wa.enviarTexto(cita.paciente_telefono, `Tu cita es en 2 horas, con ${cita.doctor_nombre}. Te esperamos en la clínica.`);
      await db.marcarRecordatorioEnviado(cita.id, '2h');
    }
  }
}

cron.schedule('*/10 * * * *', revisarRecordatorios);

module.exports = { revisarRecordatorios };
