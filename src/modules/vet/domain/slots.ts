import { localToInstant, type LocalDate } from "./local-time";
import type { DailyHours } from "./schedule";

export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Rejilla de bloques consecutivos de `durationMin` dentro de una franja,
 * anclada a la apertura de la franja. Sin buffer: la duración es estricta.
 */
export function candidateBlocks(
  date: LocalDate,
  hours: DailyHours,
  durationMin: number,
  timeZone: string,
): Interval[] {
  const out: Interval[] = [];
  for (let m = hours.openMinute; m + durationMin <= hours.closeMinute; m += durationMin) {
    out.push({
      start: localToInstant(date, m, timeZone),
      end: localToInstant(date, m + durationMin, timeZone),
    });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}
