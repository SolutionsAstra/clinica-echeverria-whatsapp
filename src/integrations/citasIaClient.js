// integrations/citasIaClient.js
// Cliente HTTP de cancelación/reagendamiento para el Asistente de WhatsApp (x-api-key, sin sesión).
// La política (plan, 48 h, límite de 1) la decide el servidor; el bot solo obedece el resultado.

const axios = require('axios');

const http = axios.create({
  baseURL: process.env.CITAS_IA_API_URL || 'http://localhost:3000/api/ia/citas',
  timeout: 8000,
  headers: { 'x-api-key': process.env.VET_API_KEY || '' },
});

class CitasIaClientError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'CitasIaClientError';
    this.code = code; // NOT_FOUND | CITA_NO_ACTIVA | LIMITE_REAGENDAMIENTO | SLOT_TAKEN | CITAS_IA_UNAVAILABLE ...
    this.status = status;
  }
}

function traducir(err) {
  const d = err.response && err.response.data;
  if (d && d.error) return new CitasIaClientError(d.error, d.mensaje || d.error, err.response.status);
  return new CitasIaClientError('CITAS_IA_UNAVAILABLE', err.message, err.response ? err.response.status : 0);
}

/**
 * @param {{ telefono: string, citaId: number, intencion: 'cancelar'|'reagendar' }} q
 * @returns {Promise<{ resultado: 'escalar', motivo: 'PLAN_BASICO'|'MENOS_DE_48H'|'LIMITE_REAGENDAMIENTO', horasDeAnticipacion: number|null }
 *                 | { resultado: 'cancelada', citaId: number, especialidad: string, pacienteNombre: string,
 *                     reagendamientosUsados: number, puedeReagendar: boolean }>}
 */
async function solicitarCancelacion(q) {
  try {
    const { data } = await http.post('/cancelar', q);
    return data;
  } catch (err) {
    throw traducir(err);
  }
}

/** @param {{ telefono: string, citaAnteriorId: number, especialidad: string, doctorId: number, inicio: string, notas?: string|null }} q */
async function reagendar(q) {
  try {
    const { data } = await http.post('/reagendar', q);
    return data;
  } catch (err) {
    throw traducir(err);
  }
}

module.exports = { solicitarCancelacion, reagendar, CitasIaClientError };