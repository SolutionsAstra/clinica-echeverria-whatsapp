// integrations/capacidadesClient.js
// El asistente pregunta al servidor qué puede hacer según el plan de la clínica.
// Falla CERRADO: si no puede leer el plan, opera en modo derivación (nunca agenda por defecto).

const axios = require('axios');

const http = axios.create({
  baseURL: process.env.CAPACIDADES_API_URL || 'http://localhost:3000/api/ia/capacidades',
  timeout: 4000,
  headers: { 'x-api-key': process.env.VET_API_KEY || '' },
});

const TTL_MS = Number(process.env.CAPACIDADES_TTL_MS) || 60_000;
const TTL_ERROR_MS = 10_000;
const SIN_AGENDAMIENTO = Object.freeze({ agendamientoAutomatico: false, origen: null, pruebaExpiraEn: null });

let cache = null; // { valor, expira }

/**
 * Caché corta: activar o vencer la prueba se refleja en ≤ TTL_MS. Si el bot usa un valor viejo,
 * el servidor igual bloquea POST /api/vet/citas y engine.js deriva a recepción.
 * @returns {Promise<{ agendamientoAutomatico: boolean, origen: 'contrato'|'prueba'|null, pruebaExpiraEn: string|null }>}
 */
async function obtenerCapacidades() {
  const ahora = Date.now();
  if (cache && cache.expira > ahora) return cache.valor;
  try {
    const { data } = await http.get('/');
    const valor = Object.freeze({
      agendamientoAutomatico: data.agendamientoAutomatico === true,
      origen: data.origen ?? null,
      pruebaExpiraEn: data.pruebaExpiraEn ?? null,
    });
    cache = { valor, expira: ahora + TTL_MS };
    return valor;
  } catch (err) {
    console.error('[capacidades] No se pudo leer el plan; modo derivación:', err.message);
    cache = { valor: SIN_AGENDAMIENTO, expira: ahora + TTL_ERROR_MS };
    return SIN_AGENDAMIENTO;
  }
}

module.exports = { obtenerCapacidades };