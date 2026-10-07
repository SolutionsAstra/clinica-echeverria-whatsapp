import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { VetError, type BookingRequest } from "../modules/vet";
import { citaManualRouter, leerInicio } from "./citaManual.routes";

const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const INICIO = `${manana}T10:00:00-04:00`;
const BODY = { nombre: "Ana Pérez", telefono: "0414 123 4567", especialidad: "neurologia", doctorId: 1, inicio: INICIO };
const BOOKING = { appointmentId: 9, patientId: 7, specialty: "neurologia" as const, doctorId: 1, doctorName: "Dr. Rojas", resourceId: 11, start: INICIO, end: `${manana}T11:00:00-04:00` };
const silencio = { error: () => undefined };

function app(book: (r: BookingRequest) => Promise<typeof BOOKING>, horarioOcupado?: () => Promise<boolean>) {
  const a = express();
  a.use(express.json());
  a.use("/api/citas/manual", citaManualRouter({ scheduler: { book }, notifier: { enviarTexto: async () => undefined }, horarioOcupado, logger: silencio }));
  return a;
}

test("inyecta origin 'panel' y responde 201", async () => {
  const vistos: BookingRequest[] = [];
  const res = await request(app(async (r) => (vistos.push(r), BOOKING))).post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 201);
  assert.equal(res.body.origen, "panel");
  assert.equal(vistos[0].origin, "panel");
  assert.equal(vistos[0].patient.telefono, "584141234567");
});

test("formulario tipo calendario: fecha + hora en hora de Caracas", () => {
  assert.equal(leerInicio({ fecha: "2026-10-07", hora: "09:30" }), "2026-10-07T09:30:00-04:00");
  assert.equal(leerInicio({ inicio: "2026-10-07T13:30:00.000Z" }), "2026-10-07T13:30:00.000Z");
  assert.equal(leerInicio({ inicio: "2026-10-07T09:30:15-04:00" }), null);
});

test("SLOT_NOT_OFFERED con choque real en citas → 409 SLOT_TAKEN", async () => {
  const res = await request(app(async () => { throw new VetError("SLOT_NOT_OFFERED", "x"); }, async () => true))
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "SLOT_TAKEN");
});

test("SLOT_NOT_OFFERED fuera de agenda → 422 estructurado", async () => {
  const res = await request(app(async () => { throw new VetError("SLOT_NOT_OFFERED", "x"); }, async () => false))
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "SLOT_NOT_OFFERED");
});

test("RESOURCE_NOT_CONFIGURED ya no es 500", async () => {
  const res = await request(app(async () => { throw new VetError("RESOURCE_NOT_CONFIGURED", "x"); })).post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 422);
});

test("columna inexistente (42703) → 503 MIGRACION_PENDIENTE", async () => {
  const res = await request(app(async () => { throw Object.assign(new Error("column \"origen\" does not exist"), { code: "42703" }); }))
    .post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "MIGRACION_PENDIENTE");
});

test("falla desconocida → 500 ERROR_AGENDA con referencia (nunca el genérico)", async () => {
  const res = await request(app(async () => { throw new Error("boom"); })).post("/api/citas/manual").send(BODY);
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "ERROR_AGENDA");
  assert.match(res.body.ref, /^[0-9a-f]{8}$/);
});