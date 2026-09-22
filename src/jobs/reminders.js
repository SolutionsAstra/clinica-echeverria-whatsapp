// jobs/reminders.js
// Cron cada 10 minutos: revisa qué citas caen en la ventana de 24h o 2h
// y aún no tienen ese recordatorio marcado como enviado en la base de datos.

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
    if (!cita.recordatorio_24h_enviado && dentroDeVentana(cita.fecha_hora_inicio, 24)) {
      await wa.enviarBotones(cita.paciente_telefono,
        `Recordatorio: mañana tienes cita con ${cita.doctor_nombre} a las ${new Date(cita.fecha_hora_inicio).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}. ¿Confirmas asistencia?`,
        [{ id: 'record_si', title: 'Sí, confirmo' }, { id: 'record_no', title: 'No, reprogramar' }]
      );
      await db.marcarRecordatorioEnviado(cita.id, '24h');
    }

    if (!cita.recordatorio_2h_enviado && dentroDeVentana(cita.fecha_hora_inicio, 2)) {
      await wa.enviarTexto(cita.paciente_telefono, `Tu cita es en 2 horas, con ${cita.doctor_nombre}. Te esperamos en la clínica.`);
      await db.marcarRecordatorioEnviado(cita.id, '2h');
    }
  }
}

cron.schedule('*/10 * * * *', revisarRecordatorios);

module.exports = { revisarRecordatorios };
