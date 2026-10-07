import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { createPgDerivacionesRepository, RECLAMO_EXPIRA_SEG } from "../infrastructure/pg-derivaciones-repository";

type Call = { text: string; params: unknown[] };

function fakePool(respond: (text: string) => { rows: unknown[]; rowCount?: number }) {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      const r = respond(text);
      return { rowCount: r.rows.length, ...r };
    },
  } as unknown as Pool;
  return { calls, getPool: async () => pool };
}

const DB_ROW = {
  id: 1041,
  telefono: "584141234567",
  paciente_nombre: "Ana Pérez",
  nombre_acudiente: null,
  especialidad: "neurologia",
  doctor_id: 1,
  doctor_nombre: "Dr. Rojas",
  bloque: "manana",
  fecha_preferida: "2026-09-29",
  notas: null,
  capturada_en: new Date("2026-09-28T13:00:00Z"),
};

test("listarPendientes: lee d.*, incluye reclamos vencidos y ordena de la más antigua a la más reciente", async () => {
  const posterior = { ...DB_ROW, id: 1050, capturada_en: new Date("2026-09-28T14:00:00Z") };
  const { calls, getPool } = fakePool(() => ({ rows: [posterior, DB_ROW] }));
  const rows = await createPgDerivacionesRepository(getPool).listarPendientes();
  assert.match(calls[0].text, /SELECT d\.\*, doc\.nombre AS doctor_nombre/);
  assert.match(calls[0].text, /d\.estado = 'pendiente' OR \(d\.estado = 'en_proceso' AND d\.reclamada_en < now\(\) - make_interval\(secs => \$1\)\)/);
  assert.deepEqual(calls[0].params, [RECLAMO_EXPIRA_SEG]);
  assert.deepEqual(rows.map((r) => r.id), [1041, 1050]);
  assert.deepEqual(rows[0], {
    id: 1041,
    telefono: "584141234567",
    pacienteNombre: "Ana Pérez",
    nombreAcudiente: null,
    especialidad: "neurologia",
    doctorId: 1,
    doctorNombre: "Dr. Rojas",
    bloque: "manana",
    fechaPreferida: "2026-09-29",
    notas: null,
    capturadaEn: new Date("2026-09-28T13:00:00Z"),
  });
});

test("acepta columnas alternativas (nombre_paciente, created_at) y fechas como Date o texto", async () => {
  const alternativa = {
    id: 7, telefono: "584141234567", nombre_paciente: "Luis Carrillo", nombre_acudiente: null,
    especialidad: "eeg", doctor_id: 5, doctor_nombre: "Dra. Méndez", bloque: "tarde",
    fecha_preferida: new Date(2026, 8, 30), notas: null, created_at: "2026-09-28T15:00:00.000Z",
  };
  const { getPool } = fakePool(() => ({ rows: [alternativa] }));
  const [r] = await createPgDerivacionesRepository(getPool).listarPendientes();
  assert.equal(r.pacienteNombre, "Luis Carrillo");
  assert.equal(r.fechaPreferida, "2026-09-30");
  assert.equal(r.capturadaEn.toISOString(), "2026-09-28T15:00:00.000Z");
});

test("filas con especialidad o bloque desconocidos se descartan en vez de romper la bandeja", async () => {
  const { getPool } = fakePool(() => ({ rows: [DB_ROW, { ...DB_ROW, id: 2, especialidad: "cardiologia" }, { ...DB_ROW, id: 3, bloque: "noche" }] }));
  const rows = await createPgDerivacionesRepository(getPool, { logger: { error: () => undefined } }).listarPendientes();
  assert.deepEqual(rows.map((r) => r.id), [1041]);
});

test("reclamar es un UPDATE condicional único (sin SELECT previo) y usa el schema indicado", async () => {
  const { calls, getPool } = fakePool(() => ({ rows: [DB_ROW] }));
  const d = await createPgDerivacionesRepository(getPool, { schema: "clinica" }).reclamar(1041, 5);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^WITH r AS \( UPDATE "clinica"\."derivaciones" SET estado = 'en_proceso'/);
  assert.match(calls[0].text, /WHERE id = \$1 AND \(estado = 'pendiente' OR \(estado = 'en_proceso' AND reclamada_en < now\(\) - make_interval\(secs => \$3\)\)\)/);
  assert.deepEqual(calls[0].params, [1041, 5, RECLAMO_EXPIRA_SEG]);
  assert.equal(d?.doctorNombre, "Dr. Rojas");
});

test("reclamar devuelve null si nadie coincidió", async () => {
  const { getPool } = fakePool(() => ({ rows: [] }));
  assert.equal(await createPgDerivacionesRepository(getPool).reclamar(1, null), null);
});

test("marcarReservada exige que siga en_proceso; si no, lanza", async () => {
  const { calls, getPool } = fakePool(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(createPgDerivacionesRepository(getPool).marcarReservada(1041, 99, 5), /no estaba en_proceso/);
  assert.match(calls[0].text, /SET estado = 'reservada', cita_id = \$2, reservada_en = now\(\), reservada_por = \$3/);
  assert.match(calls[0].text, /WHERE id = \$1 AND estado = 'en_proceso'/);
});

test("liberar solo revierte reclamos activos", async () => {
  const { calls, getPool } = fakePool(() => ({ rows: [] }));
  await createPgDerivacionesRepository(getPool).liberar(1041);
  assert.match(calls[0].text, /SET estado = 'pendiente', reclamada_en = NULL, reclamada_por = NULL WHERE id = \$1 AND estado = 'en_proceso'/);
});

test("marcarNotificacion guarda la fecha de envío o el error", async () => {
  const { calls, getPool } = fakePool(() => ({ rows: [] }));
  const repo = createPgDerivacionesRepository(getPool);
  await repo.marcarNotificacion(1, null);
  await repo.marcarNotificacion(1, "Meta 131047");
  assert.deepEqual(calls[0].params, [1, null]);
  assert.deepEqual(calls[1].params, [1, "Meta 131047"]);
  assert.match(calls[0].text, /notificado_en = CASE WHEN \$2::text IS NULL THEN now\(\) ELSE NULL END/);
});

test("registrar inserta parametrizado y devuelve el id", async () => {
  const { calls, getPool } = fakePool(() => ({ rows: [{ id: 2001 }] }));
  const id = await createPgDerivacionesRepository(getPool).registrar({
    telefono: "584141234567",
    pacienteNombre: "Ana'; DROP TABLE citas;--",
    nombreAcudiente: null,
    especialidad: "neurologia",
    doctorId: 1,
    bloque: "manana",
    fechaPreferida: "2026-09-29",
    notas: null,
  });
  assert.equal(id, 2001);
  assert.ok(!calls[0].text.includes("DROP TABLE"));
  assert.equal(calls[0].params[1], "Ana'; DROP TABLE citas;--");
});

test("rechaza nombres de schema no seguros", () => {
  assert.throws(() => createPgDerivacionesRepository(async () => ({}) as Pool, { schema: 'public"; DROP TABLE citas;--' }));
});
