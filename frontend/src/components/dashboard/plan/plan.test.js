import { test } from "node:test";
import assert from "node:assert/strict";
import { MENSAJES, MODULO, cupoOperadores, estadoModulo } from "./plan.js";
import { MENSAJES, MODULO, TITULOS, cupoOperadores, diasPruebaDe, esBloqueoPremium, estadoModulo, etiquetaPrueba } from "./plan.js";

const DIA = 86_400_000;
const AHORA = Date.parse("2026-10-04T15:00:00Z");

const plan = (modulos = {}, operadores = { activos: 1, maximo: 2 }) => ({
  modulos: {
    reportes: { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: true },
    multi_calendario: { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: false },
    notificaciones_avanzadas: { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: false },
    ...modulos,
  },
  operadores,
  diasPrueba: 3,
});

test("los mensajes comerciales son exactamente los acordados", () => {
  assert.equal(
    MENSAJES[MODULO.REPORTES],
        "Módulo Premium Activo en Plan Corporativo. Consulte a Soluciones Astra para habilitar la analítica avanzada de ausentismo (Pacientes Inasistentes).",
  );
  assert.equal(MENSAJES[MODULO.MULTI_CALENDARIO], "Función Multi-Calendario Unificado disponible contactando a Soluciones Astra.");
  assert.equal(MENSAJES[MODULO.NOTIFICACIONES], "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra.");
  assert.equal(
    MENSAJES.LIMITE_OPERADORES,
    "Límite de operadores alcanzado. Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.",
  );
});

test("sin plan cargado el módulo no se da por habilitado ni por bloqueado", () => {
  const e = estadoModulo(null, MODULO.REPORTES, AHORA);
  assert.equal(e.conocido, false);
  assert.equal(e.habilitado, false);
  assert.equal(e.pruebaDisponible, false);
});

test("módulo no contratado: bloqueado, con prueba disponible si el servidor la ofrece", () => {
  const e = estadoModulo(plan(), MODULO.REPORTES, AHORA);
  assert.deepEqual(e, { conocido: true, habilitado: false, enPrueba: false, pruebaDisponible: true, diasRestantes: null });
  assert.equal(estadoModulo(plan(), MODULO.MULTI_CALENDARIO, AHORA).pruebaDisponible, false);
});

test("módulo contratado: habilitado sin fecha de fin", () => {
  const p = plan({ reportes: { habilitado: true, origen: "contrato", pruebaExpiraEn: null, pruebaDisponible: false } });
  assert.deepEqual(estadoModulo(p, MODULO.REPORTES, AHORA), {
    conocido: true,
    habilitado: true,
    enPrueba: false,
    pruebaDisponible: false,
    diasRestantes: null,
  });
});

test("prueba vigente: habilitado y días restantes redondeados hacia arriba", () => {
  const expira = new Date(AHORA + 2 * DIA + 3_600_000).toISOString();
  const p = plan({ reportes: { habilitado: true, origen: "prueba", pruebaExpiraEn: expira, pruebaDisponible: false } });
  const e = estadoModulo(p, MODULO.REPORTES, AHORA);
  assert.equal(e.habilitado, true);
  assert.equal(e.enPrueba, true);
  assert.equal(e.diasRestantes, 3);
});

test("prueba vencida desde la última lectura: el cliente la trata como bloqueada", () => {
  const expira = new Date(AHORA - 1000).toISOString();
  const p = plan({ reportes: { habilitado: true, origen: "prueba", pruebaExpiraEn: expira, pruebaDisponible: false } });
  const e = estadoModulo(p, MODULO.REPORTES, AHORA);
  assert.equal(e.habilitado, false);
  assert.equal(e.enPrueba, false);
  assert.equal(e.pruebaDisponible, false);
});

test("cupo de operadores: libre, lleno y excedido", () => {
  assert.deepEqual(cupoOperadores(plan({}, { activos: 1, maximo: 2 })), {
    conocido: true,
    activos: 1,
    maximo: 2,
    lleno: false,
    excedente: 0,
  });
  assert.equal(cupoOperadores(plan({}, { activos: 2, maximo: 2 })).lleno, true);
  const excedido = cupoOperadores(plan({}, { activos: 3, maximo: 2 }));
  assert.equal(excedido.lleno, true);
  assert.equal(excedido.excedente, 1);
  assert.equal(cupoOperadores(null).conocido, false);
  assert.equal(cupoOperadores(null).lleno, false);
});


test("esBloqueoPremium: solo un 403 MODULO_PREMIUM, nunca un fallo de red ni otro 403", () => {
  assert.equal(esBloqueoPremium({ status: 403, code: "MODULO_PREMIUM" }), true);
  assert.equal(esBloqueoPremium({ status: 403, code: "Esa cita no pertenece a tu agenda" }), false);
  assert.equal(esBloqueoPremium({ status: undefined, code: "SIN_CONEXION" }), false);
  assert.equal(esBloqueoPremium(null), false);
});
test("días de prueba por módulo: lee diasPruebaPorModulo y no inventa pruebas", () => {
  const p = { diasPrueba: 3, diasPruebaPorModulo: { reportes: 3, agendamiento_ia: 7 } };
  assert.equal(diasPruebaDe(p, MODULO.AGENDAMIENTO_IA), 7);
  assert.equal(diasPruebaDe(p, MODULO.MULTI_CALENDARIO), 0);
  assert.equal(diasPruebaDe(null, MODULO.AGENDAMIENTO_IA), 7);
  assert.equal(etiquetaPrueba(7), "Probar Gratis por 7 días");
});

test("agendamiento_ia tiene título y mensaje de Soluciones Astra", () => {
  assert.equal(TITULOS[MODULO.AGENDAMIENTO_IA], "Agente IA Agenda");
  assert.match(MENSAJES[MODULO.AGENDAMIENTO_IA], /Soluciones Astra/);
});