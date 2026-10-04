import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_PRUEBA,
  calcularEstadoPlan,
  crearPrueba,
  esErrorLimiteBd,
  isPlanError,
  verificarCupoOperador,
  type Contrato,
  type Prueba,
} from "./domain/plan";
import { createPlanService, type PlanRepository } from "./application/plan-service";

const AHORA = new Date("2026-10-04T15:00:00Z");
const DIA = 86_400_000;
const BASE: Contrato = { maxOperadores: 2, modulos: [] };

// ---------------- Dominio ----------------

test("plan base: todo premium bloqueado; solo reportes ofrece prueba", () => {
  const e = calcularEstadoPlan(BASE, [], 1, AHORA);
  assert.deepEqual(e.modulos.reportes, { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: true });
  assert.equal(e.modulos.multi_calendario.habilitado, false);
  assert.equal(e.modulos.multi_calendario.pruebaDisponible, false);
  assert.equal(e.modulos.notificaciones_avanzadas.habilitado, false);
  assert.deepEqual(e.operadores, { activos: 1, maximo: 2 });
  assert.equal(e.diasPrueba, DIAS_PRUEBA);
});

test("módulo contratado gana a cualquier prueba", () => {
  const e = calcularEstadoPlan({ ...BASE, modulos: ["reportes"] }, [], 1, AHORA);
  assert.deepEqual(e.modulos.reportes, { habilitado: true, origen: "contrato", pruebaExpiraEn: null, pruebaDisponible: false });
});

test("prueba vigente habilita; prueba vencida bloquea y no se puede repetir", () => {
  const vigente: Prueba = { modulo: "reportes", iniciadaEn: new Date(AHORA.getTime() - DIA), expiraEn: new Date(AHORA.getTime() + DIA) };
  const e1 = calcularEstadoPlan(BASE, [vigente], 1, AHORA);
  assert.equal(e1.modulos.reportes.habilitado, true);
  assert.equal(e1.modulos.reportes.origen, "prueba");
  assert.equal(e1.modulos.reportes.pruebaExpiraEn, vigente.expiraEn.toISOString());

  const vencida: Prueba = { ...vigente, expiraEn: new Date(AHORA.getTime() - 1) };
  const e2 = calcularEstadoPlan(BASE, [vencida], 1, AHORA);
  assert.deepEqual(e2.modulos.reportes, { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: false });
});

test("cupo de operadores: el tercero se rechaza con el mensaje comercial", () => {
  assert.doesNotThrow(() => verificarCupoOperador(1, 2));
  assert.throws(
    () => verificarCupoOperador(2, 2),
    (err: unknown) =>
      isPlanError(err) &&
      err.code === "LIMITE_OPERADORES" &&
      err.message ===
        "Límite de operadores alcanzado. Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.",
  );
  assert.throws(() => verificarCupoOperador(3, 2), (err: unknown) => isPlanError(err) && err.code === "LIMITE_OPERADORES");
});

test("crearPrueba: 3 días exactos, una sola vez y solo para módulos que la ofrecen", () => {
  const p = crearPrueba("reportes", BASE, [], AHORA);
  assert.equal(p.expiraEn.getTime() - p.iniciadaEn.getTime(), DIAS_PRUEBA * DIA);
  assert.throws(() => crearPrueba("reportes", BASE, [p], AHORA), (e: unknown) => isPlanError(e) && e.code === "PRUEBA_NO_DISPONIBLE");
  assert.throws(() => crearPrueba("multi_calendario", BASE, [], AHORA), (e: unknown) => isPlanError(e) && e.code === "PRUEBA_NO_DISPONIBLE");
  assert.throws(() => crearPrueba("inventado", BASE, [], AHORA), (e: unknown) => isPlanError(e) && e.code === "MODULO_INVALIDO");
  assert.throws(
    () => crearPrueba("reportes", { ...BASE, modulos: ["reportes"] }, [], AHORA),
    (e: unknown) => isPlanError(e) && e.code === "PRUEBA_NO_DISPONIBLE",
  );
});

test("esErrorLimiteBd reconoce la excepción del trigger de Postgres", () => {
  assert.equal(esErrorLimiteBd({ code: "P0001", message: "LIMITE_OPERADORES" }), true);
  assert.equal(esErrorLimiteBd({ code: "23505", message: "duplicate key" }), false);
  assert.equal(esErrorLimiteBd(null), false);
});

// ---------------- Servicio ----------------

function fakeRepo(opts: { activos?: number; contrato?: Contrato; pruebas?: Prueba[]; conflicto?: boolean } = {}) {
  const pruebas = [...(opts.pruebas ?? [])];
  const log: string[] = [];
  const repo: PlanRepository = {
    async leerContrato() {
      return opts.contrato ?? BASE;
    },
    async contarOperadoresActivos() {
      return opts.activos ?? 1;
    },
    async listarPruebas() {
      return pruebas;
    },
    async registrarPrueba(p, usuarioId) {
      log.push(`registrar:${p.modulo}:${usuarioId}`);
      if (opts.conflicto) return false;
      pruebas.push(p);
      return true;
    },
  };
  return { repo, log };
}

test("exigirModulo: rechaza con MODULO_PREMIUM y el mensaje del módulo", async () => {
  const { repo } = fakeRepo();
  const svc = createPlanService({ repository: repo, reloj: () => AHORA });
  await assert.rejects(
    svc.exigirModulo("reportes"),
    (e: unknown) => isPlanError(e) && e.code === "MODULO_PREMIUM" && /analítica avanzada de ausentismo/.test(e.message),
  );
  await assert.rejects(
    svc.exigirModulo("notificaciones_avanzadas"),
    (e: unknown) => isPlanError(e) && e.message === "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra.",
  );
});

test("exigirCupoOperador consulta el conteo real de la base", async () => {
  const lleno = createPlanService({ repository: fakeRepo({ activos: 2 }).repo, reloj: () => AHORA });
  await assert.rejects(lleno.exigirCupoOperador(), (e: unknown) => isPlanError(e) && e.code === "LIMITE_OPERADORES");
  const libre = createPlanService({ repository: fakeRepo({ activos: 1 }).repo, reloj: () => AHORA });
  await assert.doesNotReject(libre.exigirCupoOperador());
});

test("iniciarPrueba registra quién la activó y devuelve el estado ya habilitado", async () => {
  const { repo, log } = fakeRepo();
  const svc = createPlanService({ repository: repo, reloj: () => AHORA });
  const estado = await svc.iniciarPrueba("reportes", 7);
  assert.deepEqual(log, ["registrar:reportes:7"]);
  assert.equal(estado.modulos.reportes.habilitado, true);
  assert.equal(estado.modulos.reportes.origen, "prueba");
  await assert.doesNotReject(svc.exigirModulo("reportes"));
});

test("iniciarPrueba concurrente: si otra petición ganó la carrera, PRUEBA_NO_DISPONIBLE", async () => {
  const svc = createPlanService({ repository: fakeRepo({ conflicto: true }).repo, reloj: () => AHORA });
  await assert.rejects(svc.iniciarPrueba("reportes", 7), (e: unknown) => isPlanError(e) && e.code === "PRUEBA_NO_DISPONIBLE");
});
