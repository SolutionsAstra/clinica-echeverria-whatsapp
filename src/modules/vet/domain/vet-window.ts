import { addDays, toLocalParts, type LocalDate } from "./local-time";

export type DayLabel = "hoy" | "manana" | "pasado_manana" | "dia_4";

export interface VetDay {
  date: LocalDate;
  /** Días desde hoy (0..3). */
  offset: number;
  label: DayLabel;
}

export const VET_WINDOW_DAYS = 3;
const LABELS: readonly DayLabel[] = ["hoy", "manana", "pasado_manana", "dia_4"];

/**
 * Regla VET (ventana móvil de 3 días, hora local):
 *  - antes de `cutoffHour`:00  → [Hoy, Mañana, Pasado Mañana]
 *  - a las `cutoffHour`:00 o después → Hoy se descarta y la ventana se desplaza
 *    completa: [Mañana, Pasado Mañana, Día 4]. Siempre son 3 días.
 */
export function vetDays(now: Date, timeZone: string, cutoffHour: number): VetDay[] {
  const { date: today, minuteOfDay } = toLocalParts(now, timeZone);
  const first = minuteOfDay < cutoffHour * 60 ? 0 : 1;
  return Array.from({ length: VET_WINDOW_DAYS }, (_, i) => {
    const offset = first + i;
    return { date: addDays(today, offset), offset, label: LABELS[offset] };
  });
}
