/**
 * Analítica de ausentismo (Pacientes Inasistentes) — lógica pura, probada con `node --test`.
 *
 * "Ocurrida" = cita cuyo inicio ya pasó y que no fue cancelada. Una confirmada en el pasado
 * cuenta como atendida: la clínica no siempre la marca como completada.
 * El estado en la BD sigue siendo 'no_show'; en pantalla siempre se lee "Paciente inasistente".
 */
const ESTADOS_OCURRIDOS = new Set(["confirmada", "completada", "no_show"]);
const ESTADO_INASISTENTE = "no_show";

/** @returns {{ doctorId: number, doctor: string, ocurridas: number, noShow: number, tasa: number }[]} mayor tasa primero */
export function ausentismoPorDoctor(citas, ahoraMs) {
  const porDoctor = new Map();
  for (const c of Array.isArray(citas) ? citas : []) {
    const inicio = Date.parse(c?.fecha_hora_inicio);
    if (!Number.isFinite(inicio) || inicio > ahoraMs || !ESTADOS_OCURRIDOS.has(c.estado)) continue;
    const fila = porDoctor.get(c.doctor_id) ?? { doctorId: c.doctor_id, doctor: c.doctor_nombre, ocurridas: 0, noShow: 0 };
    fila.ocurridas += 1;
    if (c.estado === ESTADO_INASISTENTE) fila.noShow += 1;
    porDoctor.set(c.doctor_id, fila);
  }
  return [...porDoctor.values()]
    .map((f) => ({ ...f, tasa: Math.round((f.noShow / f.ocurridas) * 100) }))
    .sort((a, b) => b.tasa - a.tasa || b.ocurridas - a.ocurridas || String(a.doctor).localeCompare(String(b.doctor)));
}

/**
 * Tasa de Ausentismo de un periodo [desde, hasta), solo con citas ya ocurridas.
 * origen: "ia" para contar solo las agendadas por el agente; null para todas.
 * @returns {{ ocurridas: number, inasistentes: number, tasa: number|null }}
 */
export function tasaAusentismo(citas, { desde, hasta, ahoraMs = Date.now(), origen = null } = {}) {
  const inicioPeriodo = Date.parse(desde);
  const finPeriodo = Math.min(Date.parse(hasta), ahoraMs);
  let ocurridas = 0;
  let inasistentes = 0;
  if (!Number.isFinite(inicioPeriodo) || !Number.isFinite(finPeriodo)) return { ocurridas, inasistentes, tasa: null };

  for (const c of Array.isArray(citas) ? citas : []) {
    const inicio = Date.parse(c?.fecha_hora_inicio);
    if (!Number.isFinite(inicio) || inicio < inicioPeriodo || inicio >= finPeriodo) continue;
    if (!ESTADOS_OCURRIDOS.has(c.estado)) continue;
    if (origen && c.origen !== origen) continue;
    ocurridas += 1;
    if (c.estado === ESTADO_INASISTENTE) inasistentes += 1;
  }
  return { ocurridas, inasistentes, tasa: ocurridas ? Math.round((inasistentes / ocurridas) * 100) : null };
}