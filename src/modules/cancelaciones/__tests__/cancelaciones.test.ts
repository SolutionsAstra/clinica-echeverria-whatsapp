import { test } from "node:test";
import assert from "node:assert/strict";
import { VetError } from "../../vet";
import { decidirCancelacion } from "../domain/politica";
import { CancelacionError } from "../domain/errors";
import { createCancelacionesService, type CancelacionesRepository, type CitaParaCancelar } from "../application/cancelaciones-service";

const H = 3600;
const base = { premium: true, intencion: "cancelar" as const, reagendamientosUsados: 0 };

test("política: plan básico, umbral exacto de 48 h y límite de 1 reagendamiento", () => {
  assert.deepEqual(decidirCancelacion({ ...base, premium: false, segundosHastaInicio: 100 * H }), { tipo: "escalar", motivo: "PLAN_BASICO" });
  assert.deepEqual(decidirCancelacion({ ...base, segundosHastaInicio: 48 * H - 1 }), { tipo: "escalar", motivo: "MENOS_DE_48H" });
  assert.deepEqual(decidirCancelacion({ ...base, segundosHastaInicio: 48 * H }), { tipo: "automatica" });
  assert.deepEqual(decidirCancelacion({ ...base, segundosHastaInicio: Number.NaN }), { tipo: "escalar", motivo: "MENOS_DE_48H" });
  assert.deepEqual(decidirCancelacion({ ...base, intencion: "reagendar", reagendamientosUsados: 1, segundosHastaInicio: 72 * H }), { tipo: "escalar", motivo: "LIMITE_REAGENDAMIENTO" });
  assert.deepEqual(decidirCancelacion({ ...base, reagendamientosUsados: 1, segundosHastaInicio: 72 * H }), { tipo: "automatica" });
});

const CITA: CitaParaCancelar = { citaId: 5, estado: "confirmada", especialidad: "pediatria", pacienteNombre: "Ana", reagendamientosUsados: 0, segundosHastaInicio: 72 * H };

function memoria(cita: CitaParaCancelar = CITA, over: Partial<CancelacionesRepository> = {}) {
  const log: string[] = [];
  const repo: CancelacionesRepository = {
    async leerCita() { log.push("leer"); return cita; },
    async cancelarSiAnticipada() { log.push("cancelar"); return true; },
    async reclamarCupoReagendamiento() { log.push("reclamar"); return { ok: true, usados: 1, paciente: { nombre: "Ana", esMenor: false, nombreAcudiente: null, telefonoAcudiente: null } }; },
    async liberarCupoReagendamiento() { log.push("liberar"); },
    async enlazarReagendamiento() { log.push("enlazar"); },
    ...over,
  };
  return { repo, log };
}
const fallaBook = { book: async () => { throw new VetError("SLOT_TAKEN", "x"); } };
const silencio = { error: () => undefined };
const IN = { telefono: "584141234567", citaId: 5 };

test("plan básico: escala sin tocar la base de datos", async () => {
  const { repo, log } = memoria();
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => false });
  assert.deepEqual(await svc.cancelar({ ...IN, intencion: "cancelar" }), { resultado: "escalar", motivo: "PLAN_BASICO", horasDeAnticipacion: null });
  assert.deepEqual(log, []);
});

test("premium < 48 h: escala y NO cancela", async () => {
  const { repo, log } = memoria({ ...CITA, segundosHastaInicio: 47 * H });
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => true });
  const r = await svc.cancelar({ ...IN, intencion: "cancelar" });
  assert.equal(r.resultado, "escalar");
  assert.ok(!log.includes("cancelar"));
});

test("premium >= 48 h: cancela y ofrece reagendar", async () => {
  const { repo } = memoria();
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => true });
  const r = await svc.cancelar({ ...IN, intencion: "reagendar" });
  assert.equal(r.resultado, "cancelada");
  assert.equal(r.resultado === "cancelada" && r.puedeReagendar, true);
});

test("reagendar con el contador en 1: escala sin cancelar", async () => {
  const { repo, log } = memoria({ ...CITA, reagendamientosUsados: 1 });
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => true });
  const r = await svc.cancelar({ ...IN, intencion: "reagendar" });
  assert.deepEqual(r, { resultado: "escalar", motivo: "LIMITE_REAGENDAMIENTO", horasDeAnticipacion: 72 });
  assert.ok(!log.includes("cancelar"));
});

test("si la nueva reserva falla, el cupo se devuelve", async () => {
  const { repo, log } = memoria();
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => true, logger: silencio });
  await assert.rejects(
    svc.reagendar({ telefono: "584141234567", citaAnteriorId: 5, especialidad: "pediatria", doctorId: 1, inicio: "2026-10-09T08:00:00-04:00" }),
    (e: unknown) => e instanceof VetError && e.code === "SLOT_TAKEN",
  );
  assert.deepEqual(log, ["reclamar", "liberar"]);
});

test("cupo agotado → LIMITE_REAGENDAMIENTO", async () => {
  const { repo } = memoria(CITA, { async reclamarCupoReagendamiento() { return { ok: false, motivo: "LIMITE" }; } });
  const svc = createCancelacionesService({ repository: repo, scheduler: fallaBook, agendamientoIaHabilitado: async () => true });
  await assert.rejects(
    svc.reagendar({ telefono: "584141234567", citaAnteriorId: 5, especialidad: "pediatria", doctorId: 1, inicio: "2026-10-09T08:00:00-04:00" }),
    (e: unknown) => e instanceof CancelacionError && e.code === "LIMITE_REAGENDAMIENTO",
  );
});
