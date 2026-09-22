// jobs/reportJob.js
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const axios = require('axios');
const db = require('../db');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function generarExcelParaDoctor(citasDoctor) {
  const wb = new ExcelJS.Workbook();
  const especialidadesDelDoctor = [...new Set(citasDoctor.map(c => c.especialidad_codigo))];

  for (const key of especialidadesDelDoctor) {
    const filas = citasDoctor.filter(c => c.especialidad_codigo === key);
    const sheet = wb.addWorksheet(filas[0]?.especialidad_nombre || key);
    sheet.columns = [
      { header: 'Paciente', key: 'paciente', width: 28 },
      { header: 'Fecha/Hora', key: 'fecha', width: 22 },
      { header: 'Estado', key: 'estado', width: 16 },
      { header: 'Notas', key: 'notas', width: 30 }
    ];
    filas.forEach(c => {
      sheet.addRow({
        paciente: c.paciente_nombre || 'N/D',
        fecha: new Date(c.fecha_hora_inicio).toLocaleString('es-VE'),
        estado: c.estado,
        notas: c.notas || ''
      });
    });
  }
  return wb;
}

async function refrescarPowerBI() {
  if (process.env.POWERBI_ENABLED !== 'true') return;
  try {
    const tokenResp = await axios.post(
      `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.POWERBI_CLIENT_ID,
        client_secret: process.env.POWERBI_CLIENT_SECRET,
        scope: 'https://analysis.windows.net/powerbi/api/.default'
      })
    );
    const accessToken = tokenResp.data.access_token;
    await axios.post(
      `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${process.env.POWERBI_DATASET_ID}/refreshes`,
      {}, { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    console.log('Refresh de Power BI disparado correctamente.');
  } catch (err) {
    console.error('Error refrescando Power BI:', err.response?.data || err.message);
  }
}

async function generarYEnviarReporte() {
  const citasHoy = await db.citasDeHoy();
  if (citasHoy.length === 0) {
    console.log('No hay citas hoy, se omite el envío de reporte.');
    return;
  }

  await refrescarPowerBI();

  // listarCitas trae los joins con nombre de paciente/doctor/especialidad que necesitamos
  const citasDetalladas = await db.listarCitas({});
  const idsHoy = new Set(citasHoy.map(c => c.id));
  const citasHoyDetalladas = citasDetalladas.filter(c => idsHoy.has(c.id));

  const doctores = await db.getDoctores();
  for (const doctor of doctores) {
    const citasDoctor = citasHoyDetalladas.filter(c => c.doctor_id === doctor.id);
    if (citasDoctor.length === 0) continue;

    const wb = await generarExcelParaDoctor(citasDoctor);
    const buffer = await wb.xlsx.writeBuffer();

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: doctor.email,
        subject: `Reporte de citas de hoy — ${doctor.nombre}`,
        text: `Hola ${doctor.nombre}, adjunto tu reporte de citas de hoy generado automáticamente.`,
        attachments: [{ filename: `reporte-${doctor.nombre.replace(/\s+/g, '_')}.xlsx`, content: buffer }]
      });
      await db.registrarReporteEnviado(doctor.id, 'enviado');
    } catch (err) {
      console.error(`Error enviando reporte a ${doctor.email}:`, err.message);
      await db.registrarReporteEnviado(doctor.id, 'fallido');
    }
  }
}

cron.schedule('0 18 * * *', generarYEnviarReporte);

module.exports = { generarYEnviarReporte };
