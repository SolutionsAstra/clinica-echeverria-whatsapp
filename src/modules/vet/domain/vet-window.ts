import { addDays, toLocalParts, type LocalDate } from "./local-time";

export type DayLabel = "hoy" | "manana" | "pasado_manana";

export interface VetDay {
  date: LocalDate;
  label: DayLabel;
}

const LABELS: DayLabel[] = ["hoy", "manana", "pasado_manana"];

/**
 * Regla VET: la ventana es [Hoy, Mañana, Pasado Mañana] en hora local.
 * Si el flujo entra a las `cutoffHour`:00 o después, "Hoy" se descarta.
 */
export function vetDays(now: Date, timeZone: string, cutoffHour: number): VetDay[] {
  const { date: today, minuteOfDay } = toLocalParts(now, timeZone);
  const includeToday = minuteOfDay < cutoffHour * 60;
  return LABELS.map((label, i) => ({ date: addDays(today, i), label })).filter(
    (d) => includeToday || d.label !== "hoy",
  );
}
