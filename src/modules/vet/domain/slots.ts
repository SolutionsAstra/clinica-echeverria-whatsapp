import { localToInstant, type LocalDate } from "./local-time";

export interface Interval {
  start: Date;
  end: Date;
}

export interface WorkingHours {
  /** Minuto local de apertura, p.ej. 8*60. */
  openMinute: number;
  /** Minuto local de cierre; ninguna cita puede terminar después. */
  closeMinute: number;
}

/**
 * Bloques consecutivos de `durationMin` dentro del horario de un día,
 * descartando los que se solapan con citas existentes o empiezan antes de `notBefore`.
 */
export function freeBlocks(
  date: LocalDate,
  hours: WorkingHours,
  durationMin: number,
  busy: Interval[],
  notBefore: Date,
  timeZone: string,
): Interval[] {
  const out: Interval[] = [];
  for (let m = hours.openMinute; m + durationMin <= hours.closeMinute; m += durationMin) {
    const start = localToInstant(date, m, timeZone);
    const end = localToInstant(date, m + durationMin, timeZone);
    if (start.getTime() <= notBefore.getTime()) continue;
    if (busy.some((b) => overlaps({ start, end }, b))) continue;
    out.push({ start, end });
  }
  return out;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}
