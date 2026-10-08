import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { VetError, type BookingRequest } from "../modules/vet";
import {
  citaManualRouter,
  evaluarHorario,
  leerInicio,
  parseDias,
  parseHora,
  partesCaracas,
  type LectorHorarioDoctor,
  type TurnoCrudo,
} from "./citaManual.routes";

// Doctor de lunes, martes, miércoles y viernes 08:00–16:00. NO atiende jueves (4).
const TURNOS: TurnoCrudo[] = [{ dias: "1,2,3,5", horaInicio: "08:00", horaFin: "16:00" }];

/** Próxima fecha (Caracas, a partir de mañana) cuyo día de la semana está en `dias`. */
function proximaFecha(dias: number[]): string {
  for (let k = 1; k <= 8; k++) {
    const p = partesCaracas(new Date(Date.now() + k * 86_400_000));
    if (dias.includes(p.diaSemana)) return p.fecha;
  }
  throw new Error("sin fecha");
}

const HABIL = proximaFecha([1, 2, 3, 5]);
const JUEVES = proximaFecha([4]);
const BODY = { nombre: "Ana Pérez", telefono: "0414 123 4567", especialidad: "neurologia", doctorId: 1, inicio: `${HABIL}T10:00:00-04:00` };
const BOOKING = { appointmentId: 9, patientId: 7, specialty: "neurologia" as const, doctorId: 1, doctorName: "Dr. Rojas", resourceId: 11, start: BODY.inicio, end: `${HABIL}T11:00:00-04:00` };
const silencio = { error: () => undefined, warn: () => undefined };
const HORARIO_NO_PERMITIDO = { error: "HORARIO_NO_PERMITIDO", message: "El doctor no atiende en el horario o día seleccionado" };

function app(opts: {
  book?: (r: BookingRequest) => Promise<typeof BOOKING>;
  horarioDoctor?: LectorHorarioDoctor;
  horarioOcupado?: () => Promise<boolean>;
} = {}) {
  const llamadas: BookingRequest[] = [];
  const a = express();
  a.use(express.json());
  a.use(
    "/api/citas/manual",
    citaManualRouter({
      scheduler: { book: async (r) => (llamadas.push(r), (opts.book ?? (async () => BOOKING))(r)) },
      notifier: { enviarTexto: async () => undefined },
      horarioDoctor: opts.horarioDoctor ?? (async () => TURNOS),
      horarioOcupado: opts.horarioOcupado,
      logger: silencio,
    }),
  );
  return { app: a, llamadas };
}

// ---------------- Funciones de fecha (Caracas) ----------------

test("partesCaracas usa el día y la hora de Caracas, no los del servidor", () => {
  // 02:30 UTC del viernes 9 = jueves 8 a las 22:30 en Caracas
  assert.deepEqual(partesCaracas(new Date("2026-10-09T02:30:00Z")), { fecha: "2026-10-08", diaSemana: 4, minutos: 22 * 60 + 30 });
  // medianoche en Caracas
  assert.deepEqual(partesCaracas(new Date("2026-10-08T04:00:00Z")), { fecha: "2026-10-08", diaSemana: 4, minutos: 0 });
});

test("parseHora y parseDias toleran CHAR(5), TIME e INT[]", () => {
  assert.equal(parseHora("08:00"), 480);
  assert.equal(parseHora("08:00:00"), 480);
  assert.equal(parseHora("24:00"), 1440);
  assert.equal(parseHora("25:00"), null);
  assert.deepEqual(parseDias("1,2,3"), [1, 2, 3]);
  assert.deepEqual(parseDias([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(parseDias("{1,2,3}"), [1, 2, 3]);
  assert.equal(parseDias("x,9"), null);
});

test("evaluarHorario: madrugada, día libre, fuera de turno y válido", () => {
  const caracas = (iso: string) => new Date(`${iso}-04:00`);
  // 2026-10-05 lunes · 2026-10-08 jueves
  assert.equal(evaluarHorario({ inicio: caracas("2026-10-05T03:00:00"), duracionMin: 60, turnos: TURNOS }).permitido, false);
  const madrugada = evaluarHorario({ inicio: caracas("2026-10-05T03:00:00"), duracionMin: 60, turnos: TURNOS });
  assert.equal(madrugada.permitido === false && madrugada.motivo, "FUERA_DEL_CENTRO");
  const jueves = evaluarHorario({ inicio: caracas("2026-10-08T10:00:00"), duracionMin: 60, turnos: TURNOS });
  assert.equal(jueves.permitido === false && jueves.motivo, "DIA_LIBRE");
  const tarde = evaluarHorario({ inicio: caracas("2026-10-05T15:30:00"), duracionMin: 60, turnos: TURNOS }); // termina 16:30 > 16:00
  assert.equal(tarde.permitido === false && tarde.motivo, "FUERA_DE_TURNO");
  const noche = evaluarHorario({ inicio: caracas("2026-10-05T23:30:00"), duracionMin: 60, turnos: TURNOS });
  assert.equal(noche.permitido === false && noche.motivo, "CRUZA_MEDIANOCHE");
  assert.equal(evaluarHorario({ inicio: caracas("2026-10-05T10:00:00"), duracionMin: 60, turnos: TURNOS }).permitido, true);
  assert.equal(evaluarHorario({ inicio: caracas("2026-10-05T10:00:00"), duracionMin: 60, turnos: [{ dias: [1], horaInicio: "08:00:00", horaFin: "16:00:00" }] }).permitido, true);
});

// ---------------- HTTP ----------------

test("madrugada → 422 HORARIO_NO_PERMITIDO y el motor NO se llama", async () => {
  const { app: a, llamadas } = app();
  const res = await request(a).post("/api/citas/manual").send({ ...BODY, inicio: `${HABIL}T03:00:00-04:00` });
  assert.equal(res.status, 422);
  assert.deepEqual(res.body, HORARIO_NO_PERMITIDO);
  assert.equal(llamadas.length, 0);
});

test("jueves (día libre del doctor) → 422 HORARIO_NO_PERMITIDO", async () => {
  const { app: a, llamadas } = app();
  const res = await request(a).post("/api/citas/manual").send({ ...BODY, inicio: `${JUEVES}T10:00:00-04:00` });
  assert.equal(res.status, 422);
  assert.deepEqual(res.body, HORARIO_NO_PERMITIDO);
  assert.equal(llamadas.length, 0);
});

test("doctor sin la especialidad → 422 DOCTOR_NO_HABILITADO", async () => {
  const res = await request(app({ horarioDoctor: async () => null }).app).post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "DOCTOR_NO_HABILITADO");
});

test("hora válida → 201 con origin 'panel'", async () => {
  const { app: a, llamadas } = app();
  const res = await request(a).post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 201);
  assert.equal(llamadas[0].origin, "panel");
});

test("horario corrupto lanzado por el motor (TypeError .split) → 422, nunca 500", async () => {
  const res = await request(app({ book: async () => { throw new TypeError("dias.split is not a function"); } }).app)
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "HORARIO_DOCTOR_MAL_CONFIGURADO");
});

test("parseHHMM del motor ('Hora inválida') → 422", async () => {
  const res = await request(app({ book: async () => { throw new Error('Hora inválida: "08:00:00" (se espera HH:MM)'); } }).app)
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 422);
});

test("SLOT_NOT_OFFERED con choque real → 409 SLOT_TAKEN", async () => {
  const res = await request(app({ book: async () => { throw new VetError("SLOT_NOT_OFFERED", "x"); }, horarioOcupado: async () => true }).app)
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "SLOT_TAKEN");
});

test("el lector de horarios cae (ECONNREFUSED) → 503, nunca 500", async () => {
  const res = await request(app({ horarioDoctor: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); } }).app)
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "BD_NO_DISPONIBLE");
});

test("fecha+hora del formulario tipo calendario", () => {
  assert.equal(leerInicio({ fecha: "2026-10-07", hora: "09:30" }), "2026-10-07T09:30:00-04:00");
  assert.equal(leerInicio({ inicio: "2026-10-07T09:30:15-04:00" }), null);
});

test("sin lector de horarios el router no arranca", () => {
  assert.throws(() =>
    citaManualRouter({ scheduler: { book: async () => BOOKING }, notifier: { enviarTexto: async () => undefined }, horarioDoctor: undefined as never }),
  );
});