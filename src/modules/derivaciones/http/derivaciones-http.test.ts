import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { VetError } from "../../vet";
import { DerivacionError } from "../domain/errors";
import { crearHandlers, statusPara } from "../http/derivaciones.router";
import type { DerivacionesService } from "../application/derivaciones-service";

function fakeRes() {
  const out: { status: number; body: unknown; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    set(k: string, v: string) { out.headers[k] = v; return res; },
  } as unknown as Response;
  return { res, out };
}

const req = (over: Partial<Request> & { session?: unknown } = {}) =>
  ({ params: {}, body: {}, query: {}, ...over }) as unknown as Request;

function service(over: Partial<DerivacionesService>): DerivacionesService {
  return {
    listarPendientes: async () => [],
    reservar: async () => { throw new Error("no usado"); },
    registrar: async () => "drv_1",
    ...over,
  };
}

test("mapa de errores: SLOT_TAKEN → 409, y el resto alineado con /api/vet", () => {
  assert.deepEqual(statusPara(new VetError("SLOT_TAKEN", "x")), 409);
  assert.deepEqual(statusPara(new VetError("SLOT_NOT_OFFERED", "x")), 422);
  assert.deepEqual(statusPara(new VetError("BUSY_RETRY", "x")), 503);
  assert.deepEqual(statusPara(new VetError("INVALID_INPUT", "x")), 400);
  assert.deepEqual(statusPara(new VetError("RESOURCE_NOT_CONFIGURED", "x")), 500);
  assert.deepEqual(statusPara(new DerivacionError("NOT_FOUND", "x")), 404);
  assert.deepEqual(statusPara(new DerivacionError("DERIVACION_NO_DISPONIBLE", "x")), 409);
  assert.equal(statusPara(new Error("x")), null);
});

test("GET responde el arreglo tal cual y sin caché (datos de pacientes)", async () => {
  const h = crearHandlers(service({ listarPendientes: async () => [{ id: "drv_1" } as never] }));
  const { res, out } = fakeRes();
  await h.listar(req(), res, () => assert.fail("no debe llamar next"));
  assert.deepEqual(out.body, [{ id: "drv_1" }]);
  assert.equal(out.headers["Cache-Control"], "no-store");
});

test("POST reservar: 201, pasa el id de la ruta, el cuerpo y el usuario de la sesión", async () => {
  let recibido: unknown[] = [];
  const h = crearHandlers(service({
    reservar: async (...args) => { recibido = args; return { appointmentId: 99 } as never; },
  }));
  const { res, out } = fakeRes();
  await h.reservar(req({ params: { id: "drv_7" }, body: { inicio: "x" }, session: { usuario: { id: 5 } } }), res, () => assert.fail());
  assert.equal(out.status, 201);
  assert.deepEqual(out.body, { appointmentId: 99 });
  assert.deepEqual(recibido, ["drv_7", { inicio: "x" }, { usuarioId: 5 }]);
});

test("POST reservar: SLOT_TAKEN responde 409 con { error, mensaje } (lo que lee leerCodigoError)", async () => {
  const h = crearHandlers(service({ reservar: async () => { throw new VetError("SLOT_TAKEN", "ocupado"); } }));
  const { res, out } = fakeRes();
  await h.reservar(req({ params: { id: "drv_7" } }), res, () => assert.fail());
  assert.equal(out.status, 409);
  assert.deepEqual(out.body, { error: "SLOT_TAKEN", mensaje: "ocupado" });
});

test("errores no controlados van al manejador central (no se filtran detalles de SQL)", async () => {
  const boom = new Error("relation derivaciones does not exist");
  const h = crearHandlers(service({ reservar: async () => { throw boom; } }));
  const { res } = fakeRes();
  let pasado: unknown;
  await h.reservar(req({ params: { id: "drv_7" } }), res, (e) => { pasado = e; });
  assert.equal(pasado, boom);
});

test("POST de la IA: 201 con el id público; entrada inválida → 400", async () => {
  const ok = crearHandlers(service({ registrar: async () => "drv_2001" }));
  const a = fakeRes();
  await ok.registrar(req({ body: { telefono: "584141234567" } }), a.res, () => assert.fail());
  assert.equal(a.out.status, 201);
  assert.deepEqual(a.out.body, { id: "drv_2001" });

  const bad = crearHandlers(service({ registrar: async () => { throw new DerivacionError("INVALID_INPUT", "bloque"); } }));
  const b = fakeRes();
  await bad.registrar(req({ body: null as never }), b.res, () => assert.fail());
  assert.equal(b.out.status, 400);
});
