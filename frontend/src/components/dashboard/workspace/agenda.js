/**
 * Lógica pura del Workspace (sin React): se prueba con `node --test`.
 */

/** Mismo huso que TZ_NEGOCIO en src/db.ts y CLINICA.offset en BandejaDerivaciones. */
export const ZONA_CLINICA = "America/Caracas";

export const MAX_PROXIMAS_CITAS = 3;
const UMBRAL_URGENTE_MIN = 60;
const LATENCIA_INESTABLE_MS = 1500;

const formateadoresDia = new Map();

/** "YYYY-MM-DD" del instante dado, en el huso indicado. */
export function diaEnZona(ms, zona = ZONA_CLINICA) {
  let f = formateadoresDia.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
    formateadoresDia.set(zona, f);
  }
  return f.format(ms);
}

/**
 * Estado de confirmación del paciente.
 *
 * El backend AÚN NO persiste esta respuesta: el botón `record_si` del recordatorio de 24 h
 * no se procesa en engine.js. Se lee la columna propuesta `citas.confirmacion_whatsapp_en`
 * (TIMESTAMPTZ). Mientras no exista, toda cita aparece como "pendiente", que es la verdad.
 */
export function estadoConfirmacion(cita) {
  return cita?.confirmacion_whatsapp_en ? "confirmado" : "pendiente";
}

/**
 * De la respuesta de GET /api/citas (CitaDetallada[] de src/db.ts) elige las citas
 * confirmadas de HOY en la clínica que aún no terminan, ordenadas por hora.
 *
 * @returns {{ tarjetas: Tarjeta[], restantesHoy: number }}
 */
export function seleccionarProximasCitas(citas, ahoraMs, { zona = ZONA_CLINICA, limite = MAX_PROXIMAS_CITAS } = {}) {
  const hoy = diaEnZona(ahoraMs, zona);

  const restantes = (Array.isArray(citas) ? citas : [])
    .filter((c) => c?.estado === "confirmada")
    .map((c) => {
      const inicio = Date.parse(c.fecha_hora_inicio);
      const finCrudo = Date.parse(c.fecha_hora_fin);
      return { c, inicio, fin: Number.isFinite(finCrudo) ? finCrudo : inicio };
    })
    .filter(({ inicio, fin }) => Number.isFinite(inicio) && fin > ahoraMs && diaEnZona(inicio, zona) === hoy)
    .sort((a, b) => a.inicio - b.inicio || a.c.id - b.c.id);

  const tarjetas = restantes.slice(0, limite).map(({ c, inicio, fin }) => {
    const confirmacion = estadoConfirmacion(c);
    const minutosParaInicio = Math.round((inicio - ahoraMs) / 60000);
    const enCurso = inicio <= ahoraMs;
    return {
      id: c.id,
      paciente: c.paciente_nombre,
      especialidad: c.especialidad_codigo,
      especialidadNombre: c.especialidad_nombre,
      doctor: c.doctor_nombre,
      inicio,
      fin,
      enCurso,
      minutosParaInicio,
      confirmacion,
      urgente: confirmacion === "pendiente" && !enCurso && minutosParaInicio <= UMBRAL_URGENTE_MIN,
    };
  });

  return { tarjetas, restantesHoy: restantes.length };
}

/** "sin_conexion" | "verificando" | "inestable" | "estable" */
export function clasificarRed({ online, error, latenciaMs }) {
  if (!online || error) return "sin_conexion";
  if (latenciaMs == null) return "verificando";
  return latenciaMs > LATENCIA_INESTABLE_MS ? "inestable" : "estable";
}
