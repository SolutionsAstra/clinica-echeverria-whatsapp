import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarSolicitud, normalizarSolicitudes } from "./normalizar.js";

test("camelCase del contrato actual pasa sin cambios de forma", () => {
  const s = normalizarSolicitud({
    id: "drv_1041", paciente: "Ana Pérez", telefono: "584141234567", especialidad: "neurologia",
    bloque: "manana", fecha: "2026-09-29", doctorId: 1, doctorName: "Dr. Rojas",
    capturadaEn: "2026-09-28T13:00:00.000Z", notas: "Cefalea",
  });
  assert.equal(s.paciente, "Ana Pérez");
  assert.equal(s.capturadaEn, "2026-09-28T13:00:00.000Z");
  assert.equal(s.notas, "Cefalea");
});

test("snake_case de Postgres (nombre_paciente, created_at) se traduce", () => {
  const s = normalizarSolicitud({
    id: 7, nombre_paciente: "Luis", telefono: 584125550192, especialidad: "EEG", bloque: "Mañana",
    fecha_preferida: "2026-09-30T00:00:00.000Z", doctor_id: "5", doctor_nombre: "Dra. Méndez",
    created_at: "2026-09-28T15:00:00Z", nombre_acudiente: "Carolina",
  });
  assert.deepEqual(
    { id: s.id, paciente: s.paciente, especialidad: s.especialidad, bloque: s.bloque, fecha: s.fecha, doctorId: s.doctorId, acudiente: s.acudiente },
    { id: "7", paciente: "Luis", especialidad: "eeg", bloque: "manana", fecha: "2026-09-30", doctorId: 5, acudiente: "Carolina" },
  );
});

test("filas incompletas se descartan y se cuentan; la lista sale ordenada por llegada", () => {
  const { validas, descartadas } = normalizarSolicitudes({
    data: [
      { id: 2, paciente_nombre: "B", especialidad: "pediatria", bloque: "tarde", capturada_en: "2026-09-28T12:00:00Z" },
      { id: 1, paciente_nombre: "A", especialidad: "pediatria", bloque: "tarde", capturada_en: "2026-09-28T10:00:00Z" },
      { id: 3, paciente_nombre: "C", especialidad: "cardiologia", bloque: "tarde", capturada_en: "2026-09-28T09:00:00Z" },
      { id: 4, especialidad: "eeg", bloque: "manana", capturada_en: "fecha inválida" },
    ],
  });
  assert.deepEqual(validas.map((s) => s.id), ["1", "2"]);
  assert.equal(descartadas, 2);
  assert.deepEqual(normalizarSolicitudes(null), { validas: [], descartadas: 0 });
});