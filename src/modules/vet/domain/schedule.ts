import { weekdayOf, type LocalDate } from "./local-time";

/** Franja horaria de un día, en minutos locales desde medianoche. */
export interface DailyHours {
  openMinute: number;
  /** Ninguna cita puede terminar después de este minuto. */
  closeMinute: number;
}

/** Turno semanal de un doctor (una fila de horarios_disponibilidad). */
export interface WeeklyShift extends DailyHours {
  /** 0 = domingo … 6 = sábado. */
  weekdays: number[];
}

/** 'HH:MM' → minutos. Lanza si el formato es inválido (dato corrupto en BD). */
export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Hora inválida: "${value}" (se espera HH:MM)`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`Hora fuera de rango: "${value}"`);
  return h * 60 + m;
}

/**
 * Franjas en las que un doctor puede atender en `date`: la intersección
 * del horario general del centro con cada turno del doctor que aplica ese día.
 */
export function workingHoursOn(date: LocalDate, clinic: DailyHours, shifts: WeeklyShift[]): DailyHours[] {
  const weekday = weekdayOf(date);
  return shifts
    .filter((s) => s.weekdays.includes(weekday))
    .map((s) => ({
      openMinute: Math.max(clinic.openMinute, s.openMinute),
      closeMinute: Math.min(clinic.closeMinute, s.closeMinute),
    }))
    .filter((h) => h.openMinute < h.closeMinute);
}
