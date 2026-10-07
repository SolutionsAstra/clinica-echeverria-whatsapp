/**
 * Traduce la respuesta de GET /api/derivaciones al contrato de <BandejaDerivaciones>.
 * Acepta camelCase (contrato actual) y snake_case de Postgres (paciente_nombre | nombre_paciente,
 * capturada_en | created_at…). Lógica pura, probada con `node --test`.
 * Una fila sin los datos mínimos se descarta y se cuenta: nunca rompe el render.
 */
const ESPECIALIDADES_VALIDAS = new Set(["neurologia", "eeg", "pediatria", "estetica"]);
const BLOQUES_VALIDOS = new Set(["manana", "tarde"]);

function tomar(fila, claves) {
  for (const clave of claves) {
    const valor = fila[clave];
    if (valor !== undefined && valor !== null && valor !== "") return valor;
  }
  return undefined;
}

const texto = (v) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);
const codigo = (v) =>
  typeof v === "string" ? v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() : undefined;

function aIso(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function aDia(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "string") return /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? null;
  return null;
}

/** @returns {object|null} solicitud con la forma de SolicitudDto, o null si faltan datos mínimos */
export function normalizarSolicitud(fila) {
  if (!fila || typeof fila !== "object") return null;

  const id = texto(tomar(fila, ["id", "derivacionId", "derivacion_id"]));
  const paciente = texto(tomar(fila, ["paciente", "pacienteNombre", "paciente_nombre", "nombrePaciente", "nombre_paciente"]));
  const especialidad = codigo(tomar(fila, ["especialidad", "especialidadCodigo", "especialidad_codigo"]));
  const bloque = codigo(tomar(fila, ["bloque", "bloquePreferido", "bloque_preferido"]));
  const capturadaEn = aIso(tomar(fila, ["capturadaEn", "capturada_en", "createdAt", "created_at", "creadoEn", "creado_en"]));

  if (!id || !paciente || !ESPECIALIDADES_VALIDAS.has(especialidad) || !BLOQUES_VALIDOS.has(bloque) || !capturadaEn) {
    return null;
  }

  const doctorId = Number(tomar(fila, ["doctorId", "doctor_id"]));
  const acudiente = texto(tomar(fila, ["acudiente", "nombreAcudiente", "nombre_acudiente"]));
  const notas = texto(tomar(fila, ["notas", "nota", "notes"]));
  const horas = tomar(fila, ["horasDisponibles", "horas_disponibles"]);

  return {
    id,
    paciente,
    telefono: texto(tomar(fila, ["telefono", "telefonoPaciente", "telefono_paciente"])) ?? "",
    especialidad,
    bloque,
    fecha: aDia(tomar(fila, ["fecha", "fechaPreferida", "fecha_preferida"])) ?? capturadaEn.slice(0, 10),
    doctorId: Number.isInteger(doctorId) && doctorId > 0 ? doctorId : null,
    doctorName: texto(tomar(fila, ["doctorName", "doctorNombre", "doctor_nombre"])) ?? "Doctor por asignar",
    capturadaEn,
    ...(acudiente ? { acudiente } : {}),
    ...(notas ? { notas } : {}),
    ...(Array.isArray(horas) ? { horasDisponibles: horas.filter((h) => typeof h === "string") } : {}),
  };
}

/** Acepta un arreglo o un sobre { data | solicitudes | derivaciones: [...] }. Más antigua primero. */
export function normalizarSolicitudes(respuesta) {
  const lista = Array.isArray(respuesta)
    ? respuesta
    : (respuesta?.data ?? respuesta?.solicitudes ?? respuesta?.derivaciones ?? []);
  const filas = Array.isArray(lista) ? lista : [];
  const validas = filas.map(normalizarSolicitud).filter(Boolean);
  validas.sort((a, b) => Date.parse(a.capturadaEn) - Date.parse(b.capturadaEn) || a.id.localeCompare(b.id));
  return { validas, descartadas: filas.length - validas.length };
}