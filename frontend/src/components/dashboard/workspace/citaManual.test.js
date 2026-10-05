import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefono, validarCitaManual } from "./citaManual.js";

const AHORA = Date.parse("2026-10-05T14:30:00Z"); // 10:30 en Caracas
const base = {
  nombre: "  Ana   Pérez ",
  telefono: "0414-123.45.67",
  especialidad: "pediatria",
  doctorId: "1",
  fecha: "2026-10-06",
  hora: "09:30",
  acudiente: "",
};

test("teléfono: formatos locales e internacionales a 58…", () => {
  assert.equal(normalizarTelefono("0414 123 4567"), "584141234567");
  assert.equal(normalizarTelefono("414-1234567"), "584141234567");
  assert.equal(normalizarTelefono("+58 414 123 4567"), "584141234567");
  assert.equal(normalizarTelefono("123"), null);
});

test("payload válido: hora de la clínica con offset -04:00 y nombre limpio", () => {
  const { errores, payload } = validarCitaManual(base, AHORA);
  assert.deepEqual(errores, {});
  assert.deepEqual(payload, {
    nombre: "Ana Pérez",
    telefono: "584141234567",
    especialidad: "pediatria",
    doctorId: 1,
    inicio: "2026-10-06T09:30:00-04:00",
    nombreAcudiente: null,
  });
});

test("errores en español por campo; una hora pasada se rechaza", () => {
  const { errores, payload } = validarCitaManual(
    { ...base, nombre: "A", telefono: "12", doctorId: "", fecha: "2026-10-05", hora: "08:00" },
    AHORA,
  );
  assert.equal(payload, null);
  assert.deepEqual(Object.keys(errores).sort(), ["doctorId", "hora", "nombre", "telefono"]);
  assert.match(errores.hora, /ya pasó/);
});