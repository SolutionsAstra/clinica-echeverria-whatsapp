import { test } from "node:test";
import assert from "node:assert/strict";
import { createVetScheduler } from "../application/vet-scheduler";
import type { BusyBlock, NewAppointment, Provider, SchedulingRepository } from "../application/ports";
import type { Specialty } from "../domain/specialty";
import { VetError } from "../domain/errors";

const caracas = (iso: string) => new Date(`${iso}-04:00`);
const WEEKDAYS = [1, 2, 3, 4, 5];
const fullDay = { weekdays: WEEKDAYS, openMinute: 8 * 60, closeMinute: 17 * 60 };

const ROJAS: Provider = { doctorId: 1, doctorName: "Dr. Rojas", shifts: [fullDay] };
const NUNEZ: Provider = { doctorId: 3, doctorName: "Dr. Núñez", shifts: [fullDay] };
const SALA_EEG = 10;
const CONSULTORIO_NEURO = 11;

function memoryRepo(opts: {
  providers: Partial<Record<Specialty, Provider[]>>;
  busy?: BusyBlock[];
  resources?: Record<string, number>;
}) {
  const inserted: NewAppointment[] = [];
  const repo: SchedulingRepository = {
    async providersFor(s) {
      return opts.providers[s] ?? [];
    },
    async resourceIdFor(type) {
      const all = opts.resources ?? { equipo_eeg: SALA_EEG, consultorio_neurologia: CONSULTORIO_NEURO };
      return all[type] ?? null;
    },
    async busyBetween({ doctorIds, resourceId, from, to }) {
      return (opts.busy ?? []).filter(
        (b) =>
          b.start < to &&
          b.end > from &&
          (doctorIds.includes(b.doctorId) || (resourceId !== null && b.resourceId === resourceId)),
      );
    },
    async insertIfFree(a) {
      inserted.push(a);
      return { appointmentId: 99, patientId: 7 };
    },
  };
  return { repo, inserted };
}

const starts = (day: { slots: { start: string }[] }) => day.slots.map((s) => s.start.slice(11, 16));

test("antes de las 15:00 ofrece hoy, mañana y pasado mañana; salta bloques ya pasados", async () => {
  const { repo } = memoryRepo({ providers: { pediatria: [ROJAS] } });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T10:10:00") });
  const a = await vet.getAvailability("pediatria");
  assert.deepEqual(a.days.map((d) => d.label), ["hoy", "manana", "pasado_manana"]);
  assert.equal(a.durationMin, 30);
  assert.equal(starts(a.days[0])[0], "10:30");
  assert.equal(a.days[1].slots.length, 18);
});

test("a partir de las 15:00 la ventana es mañana, pasado mañana y día 4", async () => {
  const { repo } = memoryRepo({ providers: { estetica: [ROJAS] } });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T15:00:00") });
  const a = await vet.getAvailability("estetica");
  assert.deepEqual(
    a.days.map((d) => [d.date, d.label]),
    [
      ["2026-09-29", "manana"],
      ["2026-09-30", "pasado_manana"],
      ["2026-10-01", "dia_4"],
    ],
  );
  assert.equal(a.days[0].slots.length, 12);
});

test("un EEG bloquea la sala/equipo para cualquier doctor durante 2 horas", async () => {
  const otroEeg: Provider = { doctorId: 5, doctorName: "Dra. EEG", shifts: [fullDay] };
  const { repo } = memoryRepo({
    providers: { eeg: [ROJAS, otroEeg] },
    busy: [
      {
        doctorId: 1,
        resourceId: SALA_EEG,
        start: caracas("2026-09-29T08:00:00"),
        end: caracas("2026-09-29T10:00:00"),
      },
    ],
  });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const a = await vet.getAvailability("eeg");
  assert.deepEqual(starts(a.days[0]), ["10:00", "12:00", "14:00"]);
});

test("una cita de Neurología bloquea el consultorio aunque haya otro neurólogo libre", async () => {
  const { repo } = memoryRepo({
    providers: { neurologia: [ROJAS, NUNEZ] },
    busy: [
      {
        doctorId: 1,
        resourceId: CONSULTORIO_NEURO,
        start: caracas("2026-09-29T09:00:00"),
        end: caracas("2026-09-29T10:00:00"),
      },
    ],
  });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const a = await vet.getAvailability("neurologia");
  assert.ok(!starts(a.days[0]).includes("09:00"));
  assert.equal(a.days[0].slots.length, 8);
});

test("el EEG de un doctor también le bloquea su agenda de Neurología", async () => {
  const { repo } = memoryRepo({
    providers: { neurologia: [ROJAS] },
    busy: [
      {
        doctorId: 1,
        resourceId: SALA_EEG,
        start: caracas("2026-09-29T08:00:00"),
        end: caracas("2026-09-29T10:00:00"),
      },
    ],
  });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const a = await vet.getAvailability("neurologia");
  assert.equal(starts(a.days[0])[0], "10:00");
});

test("respeta los días y horas de cada doctor dentro de 08:00–17:00", async () => {
  const lmv: Provider = {
    doctorId: 3,
    doctorName: "Dr. Núñez",
    shifts: [{ weekdays: [1, 3, 5], openMinute: 8 * 60, closeMinute: 14 * 60 }],
  };
  const { repo } = memoryRepo({ providers: { neurologia: [lmv] } });
  // lunes 28 antes de las 15 → lun 28 (pasado), mar 29 (no trabaja), mié 30
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T07:00:00") });
  const a = await vet.getAvailability("neurologia");
  assert.deepEqual(a.days.map((d) => d.slots.length), [6, 0, 6]);
});

test("si falta el recurso obligatorio en BD no ofrece nada y avisa", async () => {
  const { repo } = memoryRepo({ providers: { eeg: [ROJAS] }, resources: {} });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T09:00:00") });
  await assert.rejects(vet.getAvailability("eeg"), (e: unknown) => e instanceof VetError && e.code === "RESOURCE_NOT_CONFIGURED");
});

test("reservar un bloque ofrecido inserta con duración estricta y recurso", async () => {
  const { repo, inserted } = memoryRepo({ providers: { eeg: [ROJAS] } });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const booking = await vet.book({
    specialty: "eeg",
    doctorId: 1,
    start: "2026-09-29T10:00:00-04:00",
    patient: { telefono: "584141234567", nombre: "Ana Pérez" },
  });
  assert.equal(booking.appointmentId, 99);
  assert.equal(booking.end, "2026-09-29T12:00:00-04:00");
  assert.equal(inserted[0].resourceId, SALA_EEG);
  assert.equal(inserted[0].end.getTime() - inserted[0].start.getTime(), 120 * 60000);
});

test("rechaza bloques fuera de la ventana, desalineados u ocupados", async () => {
  const { repo, inserted } = memoryRepo({
    providers: { neurologia: [ROJAS] },
    busy: [
      {
        doctorId: 1,
        resourceId: CONSULTORIO_NEURO,
        start: caracas("2026-09-29T09:00:00"),
        end: caracas("2026-09-29T10:00:00"),
      },
    ],
  });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const patient = { telefono: "584141234567", nombre: "Ana" };
  const notOffered = (e: unknown) => e instanceof VetError && e.code === "SLOT_NOT_OFFERED";

  await assert.rejects(vet.book({ specialty: "neurologia", doctorId: 1, start: "2026-09-28T16:00:00-04:00", patient }), notOffered); // hoy descartado
  await assert.rejects(vet.book({ specialty: "neurologia", doctorId: 1, start: "2026-09-29T08:30:00-04:00", patient }), notOffered); // desalineado
  await assert.rejects(vet.book({ specialty: "neurologia", doctorId: 1, start: "2026-09-29T09:00:00-04:00", patient }), notOffered); // ocupado
  await assert.rejects(vet.book({ specialty: "neurologia", doctorId: 3, start: "2026-09-29T10:00:00-04:00", patient }), notOffered); // doctor no habilitado
  assert.equal(inserted.length, 0);
});

test("valida la entrada de la reserva", async () => {
  const { repo } = memoryRepo({ providers: { pediatria: [ROJAS] } });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T09:00:00") });
  const invalid = (e: unknown) => e instanceof VetError && e.code === "INVALID_INPUT";
  await assert.rejects(vet.book({ specialty: "pediatria", doctorId: 1, start: "mañana", patient: { telefono: "1", nombre: "A" } }), invalid);
  await assert.rejects(vet.book({ specialty: "pediatria", doctorId: 1, start: "2026-09-29T08:00:00-04:00", patient: { telefono: "", nombre: "A" } }), invalid);
  await assert.rejects(vet.book({ specialty: "pediatria", doctorId: 1, start: "2026-09-29T08:00:00-04:00", patient: { telefono: "584141234567", nombre: "Ana" }, notes: "x".repeat(401) }), invalid);
  await assert.rejects(vet.book({ specialty: "pediatria", doctorId: 1, start: "2026-09-29T08:00:00-04:00", patient: { telefono: "584141234567", nombre: "Ana", nombreAcudiente: "x".repeat(151) } }), invalid);
});

test("un segundo doctor libre en el mismo bloque también es reservable", async () => {
  const { repo, inserted } = memoryRepo({ providers: { estetica: [ROJAS, NUNEZ] } });
  const vet = createVetScheduler({ repository: repo, clock: () => caracas("2026-09-28T16:00:00") });
  const a = await vet.getAvailability("estetica");
  assert.equal(a.days[0].slots[0].doctorId, 1); // se ofrece el de mayor prioridad
  const booking = await vet.book({
    specialty: "estetica",
    doctorId: 3,
    start: a.days[0].slots[0].start,
    patient: { telefono: "584141234567", nombre: "Ana" },
  });
  assert.equal(booking.doctorName, "Dr. Núñez");
  assert.equal(inserted[0].resourceId, null);
});
