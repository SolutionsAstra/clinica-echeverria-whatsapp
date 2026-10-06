// integrations/derivacionesClient.js
// Cliente HTTP del servicio de derivaciones para el Asistente de WhatsApp (x-api-key, sin sesión).

const axios = require('axios');

const http = axios.create({
  baseURL: process.env.DERIVACIONES_API_URL || 'http://localhost:3000/api/ia/derivaciones',
  timeout: 8000,
  headers: { 'x-api-key': process.env.VET_API_KEY || '' }, // misma clave que iaApiKey en server.js
});

class DerivacionesClientError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'DerivacionesClientError';
    this.code = code;     // INVALID_INPUT | DERIVACIONES_UNAVAILABLE | api_key_invalida ...
    this.status = status;
  }
}

/**
 * Inserta una fila 'pendiente' en la bandeja. Devuelve el id público (drv_<n>).
 * @param {{ telefono: string, paciente: string, acudiente?: string|null,
 *           especialidad: 'neurologia'|'eeg'|'pediatria'|'estetica',
 *           bloque: 'manana'|'tarde', fecha: string, doctorId: number, notas?: string|null }} solicitud
 */
async function registrarDerivacion(solicitud) {
  try {
    const { data } = await http.post('/', solicitud);
    return data.id;
  } catch (err) {
    const d = err.response && err.response.data;
    if (d && d.error) throw new DerivacionesClientError(d.error, d.mensaje || d.error, err.response.status);
    throw new DerivacionesClientError('DERIVACIONES_UNAVAILABLE', err.message, err.response ? err.response.status : 0);
  }
}

module.exports = { registrarDerivacion, DerivacionesClientError };