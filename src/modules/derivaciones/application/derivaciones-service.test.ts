import { test } from "node:test";
import assert from "node:assert/strict";
import { VetError, type Booking, type BookingRequest } from "../../vet";
import { createDerivacionesService } from "../application/derivaciones-service";
import type { DerivacionesRepository, DerivacionRow, Notifier } from "../application/ports";
import { DerivacionError } from "../domain/errors";
import { formatearId, mensajeConfirmacion, parseDerivacionId, toSolicitudDto } from "../domain/derivacion";

const ROW: DerivacionRow = {
  id: 1041,
  telefono: "584141234567",
  pacienteNombre: "Ana Pérez",
  nombreAcudiente: null,
  especialidad: "neurologia",
  doctorId: 1,
  doctorNombre: "Dr. Rojas",
  bloque: "manana",
  fechaPreferida: "2026-09-29",
  notas: "Cefalea recurrente",
  capturadaEn: new Date("2026-09-28T13:00:00Z"),
};

const BOOKING: Booking = {
  appointmentId: 99,
  patientId: 7,
  specialty: "neurologia",
  doctorId: 1,
  doctorName: "Dr. Rojas",
  resourceId: 10,
  start: "2026-09-29T08:00:00-04:00",
  end: "2026-09-29T09:00:00-04:00",
};

/** Repositorio en memoria que registra cada transición de estado. */
function memoryRepo(opts: { rows?: DerivacionRow[]; reclamable?: boolean; existe?: boolean; failMarcar?: boolean } = {}) {
  const log: string[] = [];
  const repo: DerivacionesRepository = {
    async listarPendientes() { return opts.rows ?? [ROW]; },
    async reclamar(id, usuarioId) { log.push(`reclamar:${id}:${usuarioId}`); return opts.reclamable === false ? null : ROW; },
    async existe(id) { log.push(`existe:${id}`); return opts.existe ?? true; },
    async liberar(id) { log.push(`liberar:${id}`); },
    async marcarReservada(id, citaId, usuarioId) {
      log.push(`reservada:${id}:${citaId}:${usuarioId}`);
      if (opts.failMarcar) throw new Error("conexión caída");
    },
    async marcarNotificacion(id, error) { log.push(`notificacion:${id}:${error ?? "ok"}`); },
    async registrar(input) { log.push(`registrar:${input.telefono}`); return 2001; },
  };
  return { repo, log };
}

function fakeScheduler(result: Booking | Error) {
  const calls: BookingRequest[] = [];
  return {
    calls,
    scheduler: {
      async book(req: BookingRequest) {
        calls.push(req);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

function fakeNotifier(fail = false) {
  const sent: { to: string; texto: string }[] = [];
  const notifier: Notifier = {
    async enviarTexto(to, texto) {
      if (fail) throw new Error("Meta 131047");
      sent.push({ to, texto });
    },
  };
  return { notifier, sent };
}

const silent = { error: () => undefined };
const flush = () => new Promise((r) => setImmediate(r));

// ---------------- Dominio ----------------

test("id público drv_<n>: se formatea y se parsea en ambas formas", () => {
  assert.equal(formatearId(1041), "drv_1041");
  assert.equal(parseDerivacionId("drv_1041"), 1041);
  assert.equal(parseDerivacionId("1041"), 1041);
  for (const bad of ["", "drv_", "drv_-1", "drv_1.5", "abc", "drv_99999999999999999999", undefined]) {
    assert.equal(parseDerivacionId(bad), null, String(bad));
  }
});

test("toSolicitudDto produce exactamente el contrato del componente", () => {
  assert.deepEqual(toSolicitudDto(ROW), {
    id: "drv_1041",
    paciente: "Ana Pérez",
    telefono: "584141234567",
    especialidad: "neurologia",
    bloque: "manana",
    fecha: "2026-09-29",
    doctorId: 1,
    doctorName: "Dr. Rojas",
    capturadaEn: "2026-09-28T13:00:00.000Z",
    notas: "Cefalea recurrente",
  });
  // Opcionales ausentes se omiten (no se envían como null).
  const dto = toSolicitudDto({ ...ROW, notas: null, nombreAcudiente: "Carolina Díaz" });
  assert.equal("notas" in dto, false);
  assert.equal(dto.acudiente, "Carolina Díaz");
});

test("mensaje de confirmación usa hora de Caracas aunque el servidor esté en UTC", () => {
  const texto = mensajeConfirmacion({ ...ROW }, BOOKING);
  assert.match(texto, /Ana Pérez/);
  assert.match(texto, /Neurología/);
  assert.match(texto, /08:00/);
  assert.match(texto, /Dr\. Rojas/);
  assert.match(texto, /29/);
  // Menor de edad: se saluda al acudiente, la cita es del niño.
  const nino = mensajeConfirmacion({ ...ROW, pacienteNombre: "Mateo", nombreAcudiente: "Carolina" }, BOOKING);
  assert.match(nino, /Carolina/);
  assert.match(nino, /Mateo/);
});

// ---------------- Listado ----------------

test("listarPendientes devuelve DTOs en el orden del repositorio (más antigua primero)", async () => {
  const older = { ...ROW, id: 1, capturadaEn: new Date("2026-09-28T10:00:00Z") };
  const newer = { ...ROW, id: 2, capturadaEn: new Date("2026-09-28T11:00:00Z") };
  const { repo } = memoryRepo({ rows: [older, newer] });
  const svc = createDerivacionesService({ repository: repo, scheduler: fakeScheduler(BOOKING).scheduler, notifier: fakeNotifier().notifier });
  const list = await svc.listarPendientes();
  assert.deepEqual(list.map((s) => s.id), ["drv_1", "drv_2"]);
});

// ---------------- Reserva ----------------

test("reserva feliz: reclama → book con datos del servidor → cierra → notifica en segundo plano", async () => {
  const { repo, log } = memoryRepo();
  const { scheduler, calls } = fakeScheduler(BOOKING);
  const { notifier, sent } = fakeNotifier();
  const svc = createDerivacionesService({ repository: repo, scheduler, notifier });

  const r = await svc.reservar(
    "drv_1041",
    // El navegador intenta colar otro teléfono y otra especialidad: se ignoran.
    { inicio: "2026-09-29T08:00:00-04:00", paciente: { telefono: "000" }, especialidad: "eeg" },
    { usuarioId: 5 },
  );

  assert.deepEqual(r, {
    derivacionId: "drv_1041",
    appointmentId: 99,
    patientId: 7,
    doctorId: 1,
    doctorName: "Dr. Rojas",
    start: BOOKING.start,
    end: BOOKING.end,
    whatsapp: "en_cola",
  });
  assert.deepEqual(calls[0], {
    specialty: "neurologia",
    doctorId: 1,
    start: "2026-09-29T08:00:00-04:00",
    patient: { telefono: "584141234567", nombre: "Ana Pérez", esMenor: false, nombreAcudiente: null },
    notes: "Cefalea recurrente",
  });
  assert.deepEqual(log, ["reclamar:1041:5", "reservada:1041:99:5"]);
  assert.equal(sent.length, 0, "la respuesta HTTP no espera a WhatsApp");

  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "584141234567");
  assert.deepEqual(log.at(-1), "notificacion:1041:ok");
});

test("recepción puede reasignar doctor enviando doctorId", async () => {
  const { scheduler, calls } = fakeScheduler(BOOKING);
  const svc = createDerivacionesService({ repository: memoryRepo().repo, scheduler, notifier: fakeNotifier().notifier });
  await svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00", doctorId: 3 }, { usuarioId: 5 });
  assert.equal(calls[0].doctorId, 3);
});

test("SLOT_TAKEN: libera la derivación, propaga el VetError y NO notifica", async () => {
  const { repo, log } = memoryRepo();
  const { notifier, sent } = fakeNotifier();
  const svc = createDerivacionesService({
    repository: repo,
    scheduler: fakeScheduler(new VetError("SLOT_TAKEN", "ocupado")).scheduler,
    notifier,
  });
  await assert.rejects(
    svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 }),
    (e: unknown) => e instanceof VetError && e.code === "SLOT_TAKEN",
  );
  assert.deepEqual(log, ["reclamar:1041:5", "liberar:1041"]);
  await flush();
  assert.equal(sent.length, 0);
});

test("error inesperado del agendador también libera la derivación", async () => {
  const { repo, log } = memoryRepo();
  const svc = createDerivacionesService({
    repository: repo,
    scheduler: fakeScheduler(new Error("pool agotado")).scheduler,
    notifier: fakeNotifier().notifier,
    logger: silent,
  });
  await assert.rejects(svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 }), /pool agotado/);
  assert.equal(log.at(-1), "liberar:1041");
});

test("derivación ya tomada por otra recepcionista → DERIVACION_NO_DISPONIBLE sin tocar la agenda", async () => {
  const { repo } = memoryRepo({ reclamable: false, existe: true });
  const { scheduler, calls } = fakeScheduler(BOOKING);
  const svc = createDerivacionesService({ repository: repo, scheduler, notifier: fakeNotifier().notifier });
  await assert.rejects(
    svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 }),
    (e: unknown) => e instanceof DerivacionError && e.code === "DERIVACION_NO_DISPONIBLE",
  );
  assert.equal(calls.length, 0);
});

test("derivación inexistente → NOT_FOUND", async () => {
  const svc = createDerivacionesService({
    repository: memoryRepo({ reclamable: false, existe: false }).repo,
    scheduler: fakeScheduler(BOOKING).scheduler,
    notifier: fakeNotifier().notifier,
  });
  await assert.rejects(
    svc.reservar("drv_1", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 }),
    (e: unknown) => e instanceof DerivacionError && e.code === "NOT_FOUND",
  );
});

test("entrada inválida se rechaza antes de reclamar", async () => {
  const { repo, log } = memoryRepo();
  const svc = createDerivacionesService({ repository: repo, scheduler: fakeScheduler(BOOKING).scheduler, notifier: fakeNotifier().notifier });
  const invalid = (e: unknown) => e instanceof DerivacionError && e.code === "INVALID_INPUT";
  await assert.rejects(svc.reservar("abc", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 }), invalid);
  await assert.rejects(svc.reservar("drv_1", {}, { usuarioId: 5 }), invalid);
  await assert.rejects(svc.reservar("drv_1", { inicio: "2026-09-29T08:00:00-04:00", doctorId: "x" }, { usuarioId: 5 }), invalid);
  await assert.rejects(svc.reservar("drv_1", null, { usuarioId: 5 }), invalid);
  assert.equal(log.length, 0);
});

test("si cerrar la derivación falla tras crear la cita, se responde éxito (la cita existe) y se registra", async () => {
  const errors: unknown[][] = [];
  const { repo } = memoryRepo({ failMarcar: true });
  const { notifier, sent } = fakeNotifier();
  const svc = createDerivacionesService({
    repository: repo,
    scheduler: fakeScheduler(BOOKING).scheduler,
    notifier,
    logger: { error: (...a: unknown[]) => errors.push(a) },
  });
  const r = await svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 });
  assert.equal(r.appointmentId, 99);
  assert.equal(errors.length, 1);
  await flush();
  assert.equal(sent.length, 1, "el paciente igual recibe su confirmación");
});

test("fallo de WhatsApp no afecta la reserva y queda registrado en la derivación", async () => {
  const { repo, log } = memoryRepo();
  const svc = createDerivacionesService({
    repository: repo,
    scheduler: fakeScheduler(BOOKING).scheduler,
    notifier: fakeNotifier(true).notifier,
    logger: silent,
  });
  const r = await svc.reservar("drv_1041", { inicio: "2026-09-29T08:00:00-04:00" }, { usuarioId: 5 });
  assert.equal(r.whatsapp, "en_cola");
  await flush();
  assert.equal(log.at(-1), "notificacion:1041:Meta 131047");
});

// ---------------- Registro (lo usa el asistente) ----------------

test("registrar valida y normaliza la captura del asistente", async () => {
  const { repo, log } = memoryRepo();
  const svc = createDerivacionesService({ repository: repo, scheduler: fakeScheduler(BOOKING).scheduler, notifier: fakeNotifier().notifier });
  const id = await svc.registrar({
    telefono: "+58 414-123-4567",
    paciente: "  Ana Pérez ",
    especialidad: "neurologia",
    bloque: "manana",
    fecha: "2026-09-29",
    doctorId: 1,
  });
  assert.equal(id, "drv_2001");
  assert.equal(log[0], "registrar:584141234567");

  const invalid = (e: unknown) => e instanceof DerivacionError && e.code === "INVALID_INPUT";
  const base = { telefono: "584141234567", paciente: "Ana", especialidad: "neurologia", bloque: "manana", fecha: "2026-09-29", doctorId: 1 };
  await assert.rejects(svc.registrar({ ...base, especialidad: "cardiologia" }), invalid);
  await assert.rejects(svc.registrar({ ...base, bloque: "noche" }), invalid);
  await assert.rejects(svc.registrar({ ...base, fecha: "29/09/2026" }), invalid);
  await assert.rejects(svc.registrar({ ...base, fecha: "2026-02-31" }), invalid);
  await assert.rejects(svc.registrar({ ...base, paciente: " " }), invalid);
  await assert.rejects(svc.registrar({ ...base, telefono: "12" }), invalid);
});
