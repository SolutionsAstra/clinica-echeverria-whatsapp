import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  createPgSchedulingRepository,
  LOCK_NS_DOCTOR,
  LOCK_NS_RECURSO,
} from "../infrastructure/postgres/pg-scheduling-repository";
import type { NewAppointment } from "../application/ports";
import { VetError } from "../domain/errors";
import { buildQuery } from "../../../lib/sql-template";

type Call = { text: string; params: unknown[] };
type Responder = (text: string, params: unknown[]) => { rows: unknown[] } | Error;

/** Pool falso: registra cada consulta y responde según `respond`. */
function fakePool(respond: Responder) {
  const calls: Call[] = [];
  const released: unknown[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
    const result = respond(text, params);
    if (result instanceof Error) throw result;
    return result;
  };
  const pool = {
    query: run,
    connect: async () => ({ query: run, release: (arg?: unknown) => released.push(arg) }),
  } as unknown as Pool;
  return { pool, calls, released, getPool: async () => pool };
}

const appointment: NewAppointment = {
  specialty: "eeg",
  doctorId: 1,
  resourceId: 10,
  start: new Date("2026-09-29T12:00:00Z"),
  end: new Date("2026-09-29T14:00:00Z"),
  patient: { telefono: "584141234567", nombre: "Ana Pérez" },
  notes: null,
};

const okResponder: Responder = (text) => {
  if (text.includes("INSERT INTO \"public\".\"pacientes\"")) return { rows: [{ id: 7 }] };
  if (text.includes("INSERT INTO \"public\".\"citas\"")) return { rows: [{ id: 99 }] };
  return { rows: [] };
};

test("reserva: transacción con candados doctor → recurso, upsert y commit", async () => {
  const { calls, released, getPool } = fakePool(okResponder);
  const repo = createPgSchedulingRepository(getPool);
  const result = await repo.insertIfFree(appointment);

  assert.deepEqual(result, { appointmentId: 99, patientId: 7 });
  const texts = calls.map((c) => c.text);
  assert.equal(texts[0], "BEGIN");
  assert.equal(texts[1], "SET LOCAL lock_timeout = '5s'");
  assert.deepEqual(calls[2].params, [LOCK_NS_DOCTOR, 1]);
  assert.deepEqual(calls[3].params, [LOCK_NS_RECURSO, 10]);
  assert.match(texts[4], /SELECT c\.id FROM "public"\."citas"/);
  assert.match(texts[5], /ON CONFLICT \(telefono\) DO UPDATE/);
  assert.match(texts[6], /RETURNING id$/);
  assert.equal(texts[7], "COMMIT");
  assert.deepEqual(released, [false]);
});

test("reserva sin recurso no toma el candado de recurso", async () => {
  const { calls, getPool } = fakePool(okResponder);
  await createPgSchedulingRepository(getPool).insertIfFree({ ...appointment, specialty: "pediatria", resourceId: null });
  assert.equal(calls.filter((c) => c.text.includes("pg_advisory_xact_lock")).length, 1);
});

test("bloque ocupado → ROLLBACK, SLOT_TAKEN y la conexión vuelve al pool", async () => {
  const { calls, released, getPool } = fakePool((text) =>
    text.includes("SELECT c.id") ? { rows: [{ id: 5 }] } : { rows: [] },
  );
  await assert.rejects(
    createPgSchedulingRepository(getPool).insertIfFree(appointment),
    (e: unknown) => e instanceof VetError && e.code === "SLOT_TAKEN",
  );
  assert.equal(calls.at(-1)?.text, "ROLLBACK");
  assert.ok(!calls.some((c) => c.text.startsWith("INSERT")));
  assert.deepEqual(released, [false]);
});

test("lock_timeout (55P03) se traduce a BUSY_RETRY", async () => {
  const { getPool } = fakePool((text) =>
    text.includes("pg_advisory_xact_lock") ? Object.assign(new Error("lock timeout"), { code: "55P03" }) : { rows: [] },
  );
  await assert.rejects(
    createPgSchedulingRepository(getPool).insertIfFree(appointment),
    (e: unknown) => e instanceof VetError && e.code === "BUSY_RETRY",
  );
});

test("si el ROLLBACK falla la conexión se descarta", async () => {
  const { released, getPool } = fakePool((text) => {
    if (text.includes("SELECT c.id")) return new Error("conexión caída");
    if (text === "ROLLBACK") return new Error("conexión caída");
    return { rows: [] };
  });
  await assert.rejects(createPgSchedulingRepository(getPool).insertIfFree(appointment), /conexión caída/);
  assert.deepEqual(released, [true]);
});

test("busyBetween envía los doctores como int[] y mapea las filas", async () => {
  const start = new Date("2026-09-29T12:00:00Z");
  const end = new Date("2026-09-29T14:00:00Z");
  const { calls, getPool } = fakePool(() => ({
    rows: [{ doctor_id: 1, recurso_id: 10, inicio: start, fin: end }],
  }));
  const busy = await createPgSchedulingRepository(getPool).busyBetween({ doctorIds: [1, 3], resourceId: 10, from: start, to: end });
  assert.deepEqual(calls[0].params, [[1, 3], 10, start, end]);
  assert.match(calls[0].text, /c\.doctor_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(busy, [{ doctorId: 1, resourceId: 10, start, end }]);
});

test("providersFor agrupa turnos por doctor y conserva doctores sin horario", async () => {
  const { getPool } = fakePool(() => ({
    rows: [
      { doctor_id: 1, doctor_nombre: "Dr. Rojas", dias: "1,2,3,4,5", hora_inicio: "08:00", hora_fin: "16:00" },
      { doctor_id: 3, doctor_nombre: "Dr. Núñez", dias: null, hora_inicio: null, hora_fin: null },
    ],
  }));
  const providers = await createPgSchedulingRepository(getPool).providersFor("neurologia");
  assert.deepEqual(providers, [
    { doctorId: 1, doctorName: "Dr. Rojas", shifts: [{ weekdays: [1, 2, 3, 4, 5], openMinute: 480, closeMinute: 960 }] },
    { doctorId: 3, doctorName: "Dr. Núñez", shifts: [] },
  ]);
});

test("rechaza nombres de schema no seguros", () => {
  assert.throws(() => createPgSchedulingRepository(async () => ({}) as Pool, { schema: 'public"; DROP TABLE citas;--' }));
});

test("buildQuery numera los parámetros sin concatenar valores", () => {
  const id = 5;
  const tel = "' OR 1=1 --";
  const q = ((s: TemplateStringsArray, ...v: unknown[]) => buildQuery(s, v))`SELECT * FROM citas WHERE id = ${id} AND tel = ${tel}`;
  assert.equal(q.text, "SELECT * FROM citas WHERE id = $1 AND tel = $2");
  assert.deepEqual(q.values, [5, "' OR 1=1 --"]);
});
