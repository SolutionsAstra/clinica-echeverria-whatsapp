import { test } from "node:test";
import assert from "node:assert/strict";
import { ausentismoPorDoctor } from "./ausentismo.js";

const AHORA = Date.parse("2026-10-04T15:00:00Z");
const c = (id, doctor_id, estado, inicio, extra = {}) => ({
  id, doctor_id, doctor_nombre: `Dr. ${doctor_id}`, estado, fecha_hora_inicio: inicio, especialidad_codigo: "pediatria", ...extra,
});

test("tasa de no-show por doctor sobre citas ya ocurridas; canceladas y futuras no cuentan", () => {
  const citas = [
    c(1, 1, "no_show", "2026-10-01T13:00:00Z"),
    c(2, 1, "completada", "2026-10-01T14:00:00Z"),
    c(3, 1, "confirmada", "2026-10-02T14:00:00Z"), // pasada y confirmada = atendida
    c(4, 1, "cancelada", "2026-10-02T15:00:00Z"),
    c(5, 1, "no_show", "2026-10-09T15:00:00Z"), // futura: dato inconsistente, se ignora
    c(6, 2, "completada", "2026-10-03T15:00:00Z"),
  ];
  assert.deepEqual(ausentismoPorDoctor(citas, AHORA), [
    { doctorId: 1, doctor: "Dr. 1", ocurridas: 3, noShow: 1, tasa: 33 },
    { doctorId: 2, doctor: "Dr. 2", ocurridas: 1, noShow: 0, tasa: 0 },
  ]);
});

test("sin citas ocurridas no se inventa una tasa", () => {
  assert.deepEqual(ausentismoPorDoctor([c(1, 1, "confirmada", "2026-10-09T15:00:00Z")], AHORA), []);
  assert.deepEqual(ausentismoPorDoctor(null, AHORA), []);
});
