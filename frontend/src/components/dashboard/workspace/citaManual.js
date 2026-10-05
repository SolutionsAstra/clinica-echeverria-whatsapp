/** Validación del alta manual de citas — lógica pura, probada con `node --test`. */

/** Caracas: UTC-4 todo el año (mismo offset que CLINICA.offset en BandejaDerivaciones). */
export const OFFSET_CLINICA = "-04:00";

/** "0414-123.45.67" → "584141234567". Acepta formato local (0414…), sin cero (414…) o internacional. */
export function normalizarTelefono(texto) {
  let d = String(texto ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = `58${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith("4")) d = `58${d}`;
  return /^\d{11,15}$/.test(d) ? d : null;
}

/**
 * @param {{ nombre: string, telefono: string, especialidad: string, doctorId: string,
 *           fecha: string, hora: string, acudiente: string }} c
 * @returns {{ errores: Record<string, string>, payload: object|null }}
 */
export function validarCitaManual(c, ahoraMs) {
  const errores = {};
  const nombre = String(c.nombre ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 3) errores.nombre = "Escribe el nombre completo del paciente.";

  const telefono = normalizarTelefono(c.telefono);
  if (!telefono) errores.telefono = "Escribe un teléfono válido, por ejemplo 0414 123 4567.";

  if (!c.especialidad) errores.especialidad = "Elige la especialidad.";
  if (!c.doctorId) errores.doctorId = "Elige el doctor.";

  const inicio =
    /^\d{4}-\d{2}-\d{2}$/.test(c.fecha ?? "") && /^\d{2}:\d{2}$/.test(c.hora ?? "")
      ? `${c.fecha}T${c.hora}:00${OFFSET_CLINICA}`
      : null;
  if (!inicio || !Number.isFinite(Date.parse(inicio))) errores.hora = "Elige la fecha y la hora.";
  else if (Date.parse(inicio) <= ahoraMs) errores.hora = "Esa hora ya pasó. Elige una hora futura.";

  if (Object.keys(errores).length) return { errores, payload: null };

  const acudiente = String(c.acudiente ?? "").trim();
  return {
    errores,
    payload: {
      nombre,
      telefono,
      especialidad: c.especialidad,
      doctorId: Number(c.doctorId),
      inicio,
      nombreAcudiente: acudiente || null,
    },
  };
}