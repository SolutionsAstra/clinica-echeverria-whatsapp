/**
 * Analítica de ausentismo (no-show) — lógica pura, probada con `node --test`.
 * Solo se muestra con el módulo Reportes activo (contrato o prueba de 3 días).
 *
 * "Ocurrida" = cita cuyo inicio ya pasó y que no fue cancelada. Una confirmada en el pasado
 * cuenta como atendida: la clínica no siempre la marca como completada.
 */
const ESTADOS_OCURRIDOS = new Set(["confirmada", "completada", "no_show"]);

/** @returns {{ doctorId: number, doctor: string, ocurridas: number, noShow: number, tasa: number }[]} mayor tasa primero */
export function ausentismoPorDoctor(citas, ahoraMs) {
  const porDoctor = new Map();
  for (const c of Array.isArray(citas) ? citas : []) {
    const inicio = Date.parse(c?.fecha_hora_inicio);
    if (!Number.isFinite(inicio) || inicio > ahoraMs || !ESTADOS_OCURRIDOS.has(c.estado)) continue;
    const fila = porDoctor.get(c.doctor_id) ?? { doctorId: c.doctor_id, doctor: c.doctor_nombre, ocurridas: 0, noShow: 0 };
    fila.ocurridas += 1;
    if (c.estado === "no_show") fila.noShow += 1;
    porDoctor.set(c.doctor_id, fila);
  }
  return [...porDoctor.values()]
    .map((f) => ({ ...f, tasa: Math.round((f.noShow / f.ocurridas) * 100) }))
    .sort((a, b) => b.tasa - a.tasa || b.ocurridas - a.ocurridas || String(a.doctor).localeCompare(String(b.doctor)));
}
