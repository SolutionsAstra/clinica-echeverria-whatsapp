import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularVentanas, resumir } from "./domain/impacto";

const AHORA = new Date("2026-10-08T15:00:00Z");

test("prueba vigente: actual = inicio→ahora; anterior = mismo largo justo antes", () => {
  const prueba = { iniciadaEn: new Date("2026-10-05T15:00:00Z"), expiraEn: new Date("2026-10-12T15:00:00Z") };
  const v = calcularVentanas(prueba, AHORA);
  assert.equal(v.fuente, "prueba");
  assert.equal(v.pruebaVigente, true);
  assert.deepEqual(v.actual, { desde: prueba.iniciadaEn, hasta: AHORA });
  assert.deepEqual(v.anterior, { desde: new Date("2026-10-02T15:00:00Z"), hasta: prueba.iniciadaEn });
});

test("prueba vencida: el periodo termina en la expiración, no hoy", () => {
  const prueba = { iniciadaEn: new Date("2026-09-20T15:00:00Z"), expiraEn: new Date("2026-09-27T15:00:00Z") };
  const v = calcularVentanas(prueba, AHORA);
  assert.equal(v.pruebaVigente, false);
  assert.deepEqual(v.actual.hasta, prueba.expiraEn);
  assert.deepEqual(v.anterior.desde, new Date("2026-09-13T15:00:00Z"));
});

test("sin prueba: últimos 7 días contra los 7 anteriores", () => {
  const v = calcularVentanas(null, AHORA);
  assert.equal(v.fuente, "ultimos_7_dias");
  assert.deepEqual(v.actual.desde, new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(v.anterior.desde, new Date("2026-09-24T15:00:00Z"));
});

test("resumir: solo cuenta la ventana, clasifica horario y promedia la espera de recepción", () => {
  const v = { desde: new Date("2026-10-05T00:00:00Z"), hasta: new Date("2026-10-06T00:00:00Z") };
  const fuera = (d: Date) => d.getUTCHours() >= 22;
  const citas = [new Date("2026-10-05T14:00:00Z"), new Date("2026-10-05T23:00:00Z"), new Date("2026-10-06T01:00:00Z")];
  const ders = [
    { capturadaEn: new Date("2026-10-05T23:00:00Z"), reservadaEn: new Date("2026-10-06T13:00:00Z"), estado: "reservada" }, // 14 h
    { capturadaEn: new Date("2026-10-05T12:00:00Z"), reservadaEn: new Date("2026-10-05T14:00:00Z"), estado: "reservada" }, // 2 h
    { capturadaEn: new Date("2026-10-05T13:00:00Z"), reservadaEn: null, estado: "pendiente" },
    { capturadaEn: new Date("2026-10-04T13:00:00Z"), reservadaEn: null, estado: "pendiente" }, // fuera de la ventana
  ];
  assert.deepEqual(resumir(v, citas, ders, fuera), {
    citasIa: 2,
    citasIaFueraDeHorario: 1,
    derivacionesRecibidas: 3,
    derivacionesFueraDeHorario: 1,
    derivacionesReservadas: 2,
    derivacionesSinReservar: 1,
    esperaPromedioMin: 480,
  });
});

test("sin reservas, la espera promedio es null (no 0)", () => {
  const v = { desde: new Date("2026-10-05T00:00:00Z"), hasta: new Date("2026-10-06T00:00:00Z") };
  const r = resumir(v, [], [{ capturadaEn: new Date("2026-10-05T10:00:00Z"), reservadaEn: null, estado: "pendiente" }], () => false);
  assert.equal(r.esperaPromedioMin, null);
});