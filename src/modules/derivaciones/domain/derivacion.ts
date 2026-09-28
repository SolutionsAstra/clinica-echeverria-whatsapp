import type { Booking, Specialty } from "../../vet";
import type { DerivacionRow } from "../application/ports";

export type Bloque = "manana" | "tarde";
export const BLOQUES: readonly Bloque[] = ["manana", "tarde"];

const TZ_NEGOCIO = "America/Caracas";
const PREFIJO_ID = "drv_";

/** Contrato EXACTO que espera `BandejaDerivaciones.jsx` (prop `solicitudes`). */
export interface SolicitudDto {
  id: string;
  paciente: string;
  telefono: string;
  especialidad: Specialty;
  bloque: Bloque;
  fecha: string; // YYYY-MM-DD
  doctorId: number;
  doctorName: string;
  capturadaEn: string; // ISO 8601 UTC
  acudiente?: string;
  notas?: string;
}

const NOMBRE_ESPECIALIDAD: Record<Specialty, string> = {
  neurologia: "Neurología",
  eeg: "Electroencefalograma",
  pediatria: "Pediatría",
  estetica: "Medicina estética",
};

export function formatearId(id: number): string {
  return `${PREFIJO_ID}${id}`;
}

/** Acepta "drv_1041" o "1041". Devuelve null si no es un entero positivo dentro de INT4. */
export function parseDerivacionId(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const digits = raw.startsWith(PREFIJO_ID) ? raw.slice(PREFIJO_ID.length) : raw;
  if (!/^[1-9]\d{0,9}$/.test(digits)) return null;
  const n = Number(digits);
  return n <= 2_147_483_647 ? n : null;
}

export function toSolicitudDto(row: DerivacionRow): SolicitudDto {
  return {
    id: formatearId(row.id),
    paciente: row.pacienteNombre,
    telefono: row.telefono,
    especialidad: row.especialidad,
    bloque: row.bloque,
    fecha: row.fechaPreferida,
    doctorId: row.doctorId,
    doctorName: row.doctorNombre,
    capturadaEn: row.capturadaEn.toISOString(),
    ...(row.nombreAcudiente ? { acudiente: row.nombreAcudiente } : {}),
    ...(row.notas ? { notas: row.notas } : {}),
  };
}

/** Texto de confirmación. Fecha y hora SIEMPRE en huso de Caracas, no del servidor. */
export function mensajeConfirmacion(
  d: Pick<DerivacionRow, "pacienteNombre" | "nombreAcudiente" | "especialidad">,
  booking: Pick<Booking, "start" | "doctorName">,
): string {
  const inicio = new Date(booking.start);
  const dia = inicio.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: TZ_NEGOCIO });
  const hora = inicio.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ_NEGOCIO });
  const especialidad = NOMBRE_ESPECIALIDAD[d.especialidad as keyof typeof NOMBRE_ESPECIALIDAD];
  const saludo = d.nombreAcudiente
    ? `Hola ${d.nombreAcudiente}, la cita de ${especialidad} de ${d.pacienteNombre}`
    : `Hola ${d.pacienteNombre}, tu cita de ${especialidad}`;
  return (
    `✅ ${saludo} quedó confirmada.\n` +
    `📅 ${dia}, ${hora}\n` +
    `👨‍⚕️ ${booking.doctorName}\n` +
    `Te enviaremos un recordatorio antes de la cita. Si necesitas cambiarla, escríbenos por aquí.`
  );
}
