import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatasRecordatorio, filtrarCitas } from "./filtros.js";

const AHORA = Date.parse("2026-10-04T15:00:00Z");
const c = (id, inicio, extra = {}) => ({
  id, fecha_hora_inicio: inicio, estado: "confirmada", especialidad_codigo: "pediatria",
  paciente_nombre: `Paciente ${id}`, paciente_telefono: `58414000000${id}`, ...extra,
});
const CITAS = [
  c(1, "2026-10-06T14:00:00Z"),
  c(2, "2026-10-05T14:00:00Z", { especialidad_codigo: "neurologia", paciente_nombre: "Sofía Valentina" }),
  c(3, "2026-10-01T14:00:00Z", { estado: "no_show" }),
  c(4, "2026-09-30T14:00:00Z", { estado: "cancelada" }),
];

test("próximas: futuras, de la más cercana a la más lejana", () => {
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "proximas" }, AHORA).map((x) => x.id), [2, 1]);
});

test("pasadas: de la más reciente a la más antigua", () => {
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "pasadas" }, AHORA).map((x) => x.id), [3, 4]);
});

test("estado, especialidad y búsqueda sin acentos ni mayúsculas, por nombre o teléfono", () => {
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "todas", estado: "no_show" }, AHORA).map((x) => x.id), [3]);
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "todas", especialidad: "neurologia" }, AHORA).map((x) => x.id), [2]);
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "todas", texto: "  sofia " }, AHORA).map((x) => x.id), [2]);
  assert.deepEqual(filtrarCitas(CITAS, { periodo: "todas", texto: "0000001" }, AHORA).map((x) => x.id), [1]);
});

test("recordatorio manual: solo confirmadas futuras, la más cercana primero", () => {
  assert.deepEqual(candidatasRecordatorio(CITAS, AHORA).map((x) => x.id), [2, 1]);
});
