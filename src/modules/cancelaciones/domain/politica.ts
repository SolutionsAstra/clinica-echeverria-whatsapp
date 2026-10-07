/** Reglas puras de cancelación y reagendamiento autónomo (sin I/O). */

export const ANTICIPACION_MINIMA_HORAS = 48;
export const LIMITE_REAGENDAMIENTOS_IA = 1;

export const INTENCIONES = ["cancelar", "reagendar"] as const;
export type Intencion = (typeof INTENCIONES)[number];

export type MotivoEscalada = "PLAN_BASICO" | "MENOS_DE_48H" | "LIMITE_REAGENDAMIENTO";

export type Decision = { tipo: "automatica" } | { tipo: "escalar"; motivo: MotivoEscalada };

export const esIntencion = (v: unknown): v is Intencion => typeof v === "string" && (INTENCIONES as readonly string[]).includes(v);

/**
 * @param segundosHastaInicio medido en la BD (fecha_hora_inicio - now()) sobre TIMESTAMPTZ.
 *   Caracas no tiene horario de verano, así que 48 h absolutas = 48 h de reloj en Caracas.
 */
export function decidirCancelacion(e: {
  premium: boolean;
  segundosHastaInicio: number;
  intencion: Intencion;
  reagendamientosUsados: number;
}): Decision {
  if (!e.premium) return { tipo: "escalar", motivo: "PLAN_BASICO" };
  // "48 horas o más" es automático; NaN o negativo cae aquí por seguridad.
  if (!(e.segundosHastaInicio >= ANTICIPACION_MINIMA_HORAS * 3600)) return { tipo: "escalar", motivo: "MENOS_DE_48H" };
  if (e.intencion === "reagendar" && e.reagendamientosUsados >= LIMITE_REAGENDAMIENTOS_IA) {
    return { tipo: "escalar", motivo: "LIMITE_REAGENDAMIENTO" };
  }
  return { tipo: "automatica" };
}

export const horasRestantes = (segundos: number): number => Math.max(0, Math.floor(segundos / 3600));