import { test } from "node:test";
import assert from "node:assert/strict";
import { vetDays } from "../domain/vet-window";
import { candidateBlocks } from "../domain/slots";
import { workingHoursOn, parseHHMM } from "../domain/schedule";
import { durationOf, parseSpecialty, SPECIALTIES } from "../domain/specialty";
import { toLocalIso } from "../domain/local-time";

const TZ = "America/Caracas";
const CLINIC = { openMinute: 8 * 60, closeMinute: 17 * 60 };
/** Instante a partir de una hora local de Caracas (UTC-4). */
const caracas = (iso: string) => new Date(`${iso}-04:00`);

test("ventana VET antes de las 15:00 → [hoy, mañana, pasado mañana]", () => {
  const days = vetDays(caracas("2026-09-28T14:59:00"), TZ, 15);
  assert.deepEqual(
    days.map((d) => [d.date, d.label]),
    [
      ["2026-09-28", "hoy"],
      ["2026-09-29", "manana"],
      ["2026-09-30", "pasado_manana"],
    ],
  );
});

test("ventana VET a las 15:00 en punto descarta hoy y desplaza 3 días completos", () => {
  const days = vetDays(caracas("2026-09-28T15:00:00"), TZ, 15);
  assert.deepEqual(
    days.map((d) => [d.date, d.label]),
    [
      ["2026-09-29", "manana"],
      ["2026-09-30", "pasado_manana"],
      ["2026-10-01", "dia_4"],
    ],
  );
});

test("la ventana usa la fecha de Caracas aunque en UTC ya sea el día siguiente", () => {
  // 22:30 del 30-sep en Caracas = 02:30 UTC del 1-oct
  const days = vetDays(new Date("2026-10-01T02:30:00Z"), TZ, 15);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
});

test("duraciones estrictas por especialidad", () => {
  assert.equal(durationOf("pediatria"), 30);
  assert.equal(durationOf("estetica"), 45);
  assert.equal(durationOf("neurologia"), 60);
  assert.equal(durationOf("eeg"), 120);
  assert.deepEqual([...SPECIALTIES].sort(), ["eeg", "estetica", "neurologia", "pediatria"]);
});

test("parseSpecialty acepta texto libre del asistente", () => {
  assert.equal(parseSpecialty("Electroencefalografía"), "eeg");
  assert.equal(parseSpecialty("Medicina Estética"), "estetica");
  assert.equal(parseSpecialty("NEUROLOGÍA"), "neurologia");
  assert.equal(parseSpecialty("cardiologia"), null);
});

test("rejilla 08:00–17:00: cantidad de bloques por especialidad", () => {
  const count = (min: number) => candidateBlocks("2026-09-28", CLINIC, min, TZ).length;
  assert.equal(count(30), 18);
  assert.equal(count(45), 12);
  assert.equal(count(60), 9);
  assert.equal(count(120), 4); // 08, 10, 12, 14 — 16:00 terminaría 18:00
});

test("los bloques se expresan en hora de Caracas", () => {
  const [first] = candidateBlocks("2026-09-28", CLINIC, 120, TZ);
  assert.equal(toLocalIso(first.start, TZ), "2026-09-28T08:00:00-04:00");
  assert.equal(toLocalIso(first.end, TZ), "2026-09-28T10:00:00-04:00");
});

test("horario del doctor se intersecta con el horario del centro", () => {
  const shifts = [{ weekdays: [1, 2, 3, 4, 5], openMinute: parseHHMM("07:00"), closeMinute: parseHHMM("16:00") }];
  assert.deepEqual(workingHoursOn("2026-09-28", CLINIC, shifts), [{ openMinute: 480, closeMinute: 960 }]); // lunes
  assert.deepEqual(workingHoursOn("2026-09-27", CLINIC, shifts), []); // domingo
});

test("parseHHMM rechaza datos corruptos", () => {
  assert.throws(() => parseHHMM("8:00"));
  assert.throws(() => parseHHMM("25:00"));
});
