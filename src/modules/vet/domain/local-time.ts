/**
 * Utilidades de fecha/hora local basadas en Intl (sin dependencias).
 * Venezuela usa UTC-04:00 fijo desde 2016, pero no se asume: el offset se
 * obtiene de la base IANA del runtime, así un cambio futuro de huso no rompe nada.
 */

/** Fecha civil local, formato YYYY-MM-DD. */
export type LocalDate = string;

export interface LocalParts {
  date: LocalDate;
  /** Minutos desde la medianoche local (0..1439). */
  minuteOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function partsOf(instant: Date, timeZone: string) {
  const p: Record<string, string> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

export function toLocalParts(instant: Date, timeZone: string): LocalParts {
  const p = partsOf(instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minuteOfDay: p.hour * 60 + p.minute };
}

/** Offset del huso respecto a UTC en minutos (Caracas → -240). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Instante UTC correspondiente a `date` + `minuteOfDay` en hora local. */
export function localToInstant(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const offset = offsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día de la semana de una fecha civil: 0 = domingo … 6 = sábado (igual que horarios_disponibilidad.dias). */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO 8601 con el offset local explícito, p.ej. 2026-09-28T08:00:00-04:00. */
export function toLocalIso(instant: Date, timeZone: string): string {
  const p = partsOf(instant, timeZone);
  const off = offsetMinutes(instant, timeZone);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
