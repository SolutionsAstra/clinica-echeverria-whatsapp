// integrations/vetClient.js
// Cliente del módulo VET para el Asistente de WhatsApp. El asistente NO importa
// el módulo: lo consume por HTTP, así puede vivir en otro proceso o servidor.

const axios = require('axios');

const http = axios.create({
  baseURL: process.env.VET_API_URL || 'http://localhost:3000/api/vet',
  timeout: 8000,
  headers: { 'x-api-key': process.env.VET_API_KEY || '' }
});

class VetClientError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'VetClientError';
    this.code = code;       // SLOT_TAKEN | SLOT_NOT_OFFERED | INVALID_INPUT | BUSY_RETRY | ...
    this.status = status;
  }
}

function traducirError(err) {
  const data = err.response && err.response.data;
  if (data && data.error) return new VetClientError(data.error, data.mensaje || data.error, err.response.status);
  return new VetClientError('VET_UNAVAILABLE', err.message, err.response ? err.response.status : 0);
}

/**
 * @param {'pediatria'|'estetica'|'neurologia'|'eeg'} especialidad
 * @returns {Promise<{ specialty, durationMin, timeZone, generatedAt,
 *   days: { date, label: 'hoy'|'manana'|'pasado_manana'|'dia_4',
 *           slots: { start, end, doctorId, doctorName }[] }[] }>}
 */
async function obtenerDisponibilidad(especialidad) {
  try {
    const { data } = await http.get('/disponibilidad', { params: { especialidad } });
    return data;
  } catch (err) {
    throw traducirError(err);
  }
}

/**
 * @param {{ especialidad: string, doctorId: number, inicio: string,
 *           paciente: { telefono: string, nombre: string, esMenor?: boolean,
 *                       nombreAcudiente?: string, telefonoAcudiente?: string },
 *           notas?: string }} reserva
 */
async function reservar(reserva) {
  try {
    const { data } = await http.post('/citas', reserva);
    return data;
  } catch (err) {
    throw traducirError(err);
  }
}

module.exports = { obtenerDisponibilidad, reservar, VetClientError };
