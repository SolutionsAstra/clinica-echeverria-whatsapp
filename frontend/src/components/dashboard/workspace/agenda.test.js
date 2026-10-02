// Ejecutar: node --test frontend/src/components/dashboard/workspace/agenda.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarRed, diaEnZona, estadoConfirmacion, seleccionarProximasCitas } from "./agenda.js";

const ZONA = "America/Caracas"; // UTC-4 todo el año
// 30-sep-2026 10:00 en Caracas = 14:00Z
const AHORA = Date.parse("2026-09-30T14:00:00Z");

const cita = (id, inicioZ, extra = {}) => ({
  id,
  estado: "confirmada",
  paciente_nombre: `Paciente ${id}`,
  especialidad_codigo: "pediatria",
  especialidad_nombre: "Pediatría",
  doctor_nombre: "Dra. Salas",
  fecha_hora_inicio: inicioZ,
  fecha_hora_fin: new Date(Date.parse(inicioZ) + 30 * 60000).toISOString(),
  ...extra,
});

test("diaEnZona usa el huso de la clínica, no UTC", () => {
  // 02:00Z del 1-oct todavía es 30-sep en Caracas
  assert.equal(diaEnZona(Date.parse("2026-10-01T02:00:00Z"), ZONA), "2026-09-30");
});

test("devuelve como máximo 3 citas de hoy, ordenadas por hora", () => {
  const citas = [
    cita(5, "2026-09-30T19:00:00Z"),
    cita(1, "2026-09-30T15:00:00Z"),
    cita(3, "2026-09-30T17:00:00Z"),
    cita(2, "2026-09-30T16:00:00Z"),
  ];
  const { tarjetas, restantesHoy } = seleccionarProximasCitas(citas, AHORA, { zona: ZONA });
  assert.deepEqual(tarjetas.map((t) => t.id), [1, 2, 3]);
  assert.equal(restantesHoy, 4);
});

test("excluye canceladas, terminadas y de otros días; incluye la que está en curso", () => {
  const citas = [
    cita(1, "2026-09-30T13:00:00Z"), // terminó 13:30Z
    cita(2, "2026-09-30T13:45:00Z"), // en curso hasta 14:15Z
    cita(3, "2026-09-30T15:00:00Z", { estado: "cancelada" }),
    cita(4, "2026-10-01T15:00:00Z"), // mañana
    cita(5, "2026-10-01T03:30:00Z"), // 23:30 de hoy en Caracas
  ];
  const { tarjetas } = seleccionarProximasCitas(citas, AHORA, { zona: ZONA });
  assert.deepEqual(tarjetas.map((t) => t.id), [2, 5]);
  assert.equal(tarjetas[0].enCurso, true);
  assert.equal(tarjetas[1].enCurso, false);
});

test("ignora filas con fechas inválidas sin romper", () => {
  const rota = { ...cita(1, "2026-09-30T15:00:00Z"), fecha_hora_inicio: "no-es-fecha", fecha_hora_fin: null };
  const { tarjetas } = seleccionarProximasCitas([rota], AHORA, { zona: ZONA });
  assert.equal(tarjetas.length, 0);
});

test("marca como urgente una cita pendiente que empieza en menos de 60 min", () => {
  const { tarjetas } = seleccionarProximasCitas(
    [cita(1, "2026-09-30T14:40:00Z"), cita(2, "2026-09-30T14:50:00Z", { confirmacion_whatsapp_en: "2026-09-29T10:00:00Z" })],
    AHORA,
    { zona: ZONA },
  );
  assert.equal(tarjetas[0].urgente, true);
  assert.equal(tarjetas[1].urgente, false);
  assert.equal(tarjetas[0].minutosParaInicio, 40);
});

test("estadoConfirmacion depende solo de confirmacion_whatsapp_en", () => {
  assert.equal(estadoConfirmacion({}), "pendiente");
  assert.equal(estadoConfirmacion({ confirmacion_whatsapp_en: null }), "pendiente");
  assert.equal(estadoConfirmacion({ confirmacion_whatsapp_en: "2026-09-29T10:00:00Z" }), "confirmado");
});

test("clasificarRed", () => {
  assert.equal(clasificarRed({ online: false, error: null, latenciaMs: 20 }), "sin_conexion");
  assert.equal(clasificarRed({ online: true, error: new Error("x"), latenciaMs: null }), "sin_conexion");
  assert.equal(clasificarRed({ online: true, error: null, latenciaMs: null }), "verificando");
  assert.equal(clasificarRed({ online: true, error: null, latenciaMs: 2400 }), "inestable");
  assert.equal(clasificarRed({ online: true, error: null, latenciaMs: 90 }), "estable");
});
