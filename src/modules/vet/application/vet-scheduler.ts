import { localToInstant, addDays, toLocalIso, type LocalDate } from "../domain/local-time";
import { freeBlocks, type WorkingHours } from "../domain/slots";
import { durationOf, type Specialty } from "../domain/specialty";
import { vetDays, type DayLabel } from "../domain/vet-window";
import type { BusyAgenda, Clock } from "./ports";

export interface VetConfig {
  timeZone: string;
  cutoffHour: number;
  workingHours: WorkingHours;
}

export const DEFAULT_VET_CONFIG: VetConfig = {
  timeZone: "America/Caracas",
  cutoffHour: 15,
  workingHours: { openMinute: 8 * 60, closeMinute: 17 * 60 },
};

export interface AvailableSlot {
  /** ISO 8601 con offset local, p.ej. 2026-09-22T08:00:00-04:00 */
  start: string;
  end: string;
}

export interface AvailableDay {
  date: LocalDate;
  label: DayLabel;
  slots: AvailableSlot[];
}

export interface Availability {
  specialty: Specialty;
  durationMin: number;
  generatedAt: string;
  days: AvailableDay[];
}

export interface VetScheduler {
  getAvailability(specialty: Specialty): Promise<Availability>;
}

export function createVetScheduler(deps: {
  agenda: BusyAgenda;
  clock?: Clock;
  config?: Partial<VetConfig>;
}): VetScheduler {
  const clock = deps.clock ?? (() => new Date());
  const cfg: VetConfig = { ...DEFAULT_VET_CONFIG, ...deps.config };

  return {
    async getAvailability(specialty) {
      const now = clock();
      const durationMin = durationOf(specialty);
      const days = vetDays(now, cfg.timeZone, cfg.cutoffHour);

      const from = localToInstant(days[0].date, 0, cfg.timeZone);
      const to = localToInstant(addDays(days[days.length - 1].date, 1), 0, cfg.timeZone);
      const busy = await deps.agenda.busyBetween(specialty, from, to);

      return {
        specialty,
        durationMin,
        generatedAt: toLocalIso(now, cfg.timeZone),
        days: days.map(({ date, label }) => ({
          date,
          label,
          slots: freeBlocks(date, cfg.workingHours, durationMin, busy, now, cfg.timeZone).map(
            (s) => ({ start: toLocalIso(s.start, cfg.timeZone), end: toLocalIso(s.end, cfg.timeZone) }),
          ),
        })),
      };
    },
  };
}
