/** Filtros de la vista Citas — lógica pura, probada con `node --test`. */

const normalizar = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * @param {{ periodo?: 'proximas'|'pasadas'|'todas', estado?: string, especialidad?: string, texto?: string }} filtros
 * Próximas: de la más cercana a la más lejana. Pasadas y todas: la más reciente primero.
 */
export function filtrarCitas(citas, { periodo = "proximas", estado = "", especialidad = "", texto = "" } = {}, ahoraMs) {
  const q = normalizar(texto);
  const qDigitos = q.replace(/\D/g, "");
  const lista = (Array.isArray(citas) ? citas : []).filter((c) => {
    const inicio = Date.parse(c.fecha_hora_inicio);
    if (periodo === "proximas" && !(inicio >= ahoraMs)) return false;
    if (periodo === "pasadas" && !(inicio < ahoraMs)) return false;
    if (estado && c.estado !== estado) return false;
    if (especialidad && c.especialidad_codigo !== especialidad) return false;
    if (q) {
      const enNombre = normalizar(c.paciente_nombre).includes(q);
      const enTelefono = qDigitos.length >= 3 && String(c.paciente_telefono ?? "").includes(qDigitos);
      if (!enNombre && !enTelefono) return false;
    }
    return true;
  });
  const asc = periodo === "proximas";
  return lista.sort((a, b) => {
    const d = Date.parse(a.fecha_hora_inicio) - Date.parse(b.fecha_hora_inicio);
    return (asc ? d : -d) || a.id - b.id;
  });
}

/** A quién iría el recordatorio manual: confirmadas que aún no empiezan. */
export function candidatasRecordatorio(citas, ahoraMs) {
  return (Array.isArray(citas) ? citas : [])
    .filter((c) => c.estado === "confirmada" && Date.parse(c.fecha_hora_inicio) > ahoraMs)
    .sort((a, b) => Date.parse(a.fecha_hora_inicio) - Date.parse(b.fecha_hora_inicio) || a.id - b.id);
}
