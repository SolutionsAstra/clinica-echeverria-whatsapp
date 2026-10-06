import type { Pool, PoolClient } from "pg";
import type { BusyBlock, NewAppointment, Provider, SchedulingRepository } from "../../application/ports";
import { parseHHMM, type WeeklyShift } from "../../domain/schedule";
import { VetError } from "../../domain/errors";

/**
 * Adaptador PostgreSQL (Supabase) del repositorio VET.
 *
 * FECHAS: `citas.fecha_hora_inicio/fin` son TIMESTAMPTZ; node-postgres las lee y
 * escribe como Date (instante absoluto), así que no importa el huso del servidor.
 *
 * CONCURRENCIA: `pg_advisory_xact_lock(espacio, id)` serializa las reservas que
 * compiten por el mismo doctor o el mismo recurso. Los candados se liberan solos
 * al terminar la transacción, por lo que funcionan también detrás del pooler de
 * Supabase en modo transacción (puerto 6543).
 */
const ACTIVE_STATES = "('confirmada','completada')";
/** Espacios de nombres de los advisory locks (primer argumento de la versión int4,int4). */
export const LOCK_NS_DOCTOR = 71_001;
export const LOCK_NS_RECURSO = 71_002;
const LOCK_TIMEOUT = "5s";

export interface PgRepositoryOptions {
  /** Schema donde viven las tablas. Por defecto 'public'. */
  schema?: string;
}

export function createPgSchedulingRepository(
  getPool: () => Promise<Pool>,
  options: PgRepositoryOptions = {},
): SchedulingRepository {
  const s = quoteIdent(options.schema ?? "public");
  const t = (table: string) => `${s}.${quoteIdent(table)}`;

  return {
    async providersFor(specialty) {
      const pool = await getPool();
      const { rows } = await pool.query<{
        doctor_id: number;
        doctor_nombre: string;
        dias: string | null;
        hora_inicio: string | null;
        hora_fin: string | null;
      }>(
        `SELECT d.id AS doctor_id, d.nombre AS doctor_nombre, h.dias, h.hora_inicio, h.hora_fin
         FROM ${t("doctores")} d
         JOIN ${t("doctor_especialidad")} de ON de.doctor_id = d.id
         JOIN ${t("especialidades")} e      ON e.id = de.especialidad_id
         LEFT JOIN ${t("horarios_disponibilidad")} h ON h.doctor_id = d.id
         WHERE e.codigo = $1 AND d.activo
         ORDER BY d.id, h.id`,
        [specialty],
      );

      const byDoctor = new Map<number, Provider>();
      for (const row of rows) {
        const provider = byDoctor.get(row.doctor_id) ?? { doctorId: row.doctor_id, doctorName: row.doctor_nombre, shifts: [] };
        if (row.dias && row.hora_inicio && row.hora_fin) provider.shifts.push(toShift(row.dias, row.hora_inicio, row.hora_fin));
        byDoctor.set(row.doctor_id, provider);
      }
      return [...byDoctor.values()];
    },

    async resourceIdFor(resourceType) {
      const pool = await getPool();
      const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM ${t("recursos")} WHERE tipo = $1 ORDER BY id LIMIT 1`,
        [resourceType],
      );
      return rows[0]?.id ?? null;
    },

    async busyBetween({ doctorIds, resourceId, from, to }) {
      const pool = await getPool();
      const { rows } = await pool.query<{ doctor_id: number; recurso_id: number | null; inicio: Date; fin: Date }>(
        `SELECT c.doctor_id, c.recurso_id, c.fecha_hora_inicio AS inicio, c.fecha_hora_fin AS fin
         FROM ${t("citas")} c
         WHERE c.estado IN ${ACTIVE_STATES}
           AND c.fecha_hora_inicio < $4
           AND c.fecha_hora_fin    > $3
           AND (c.doctor_id = ANY($1::int[]) OR ($2::int IS NOT NULL AND c.recurso_id = $2::int))`,
        [doctorIds, resourceId, from, to],
      );
      return rows.map<BusyBlock>((r) => ({ doctorId: r.doctor_id, resourceId: r.recurso_id, start: r.inicio, end: r.fin }));
    },

    async insertIfFree(a: NewAppointment) {
      const pool = await getPool();
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        // Orden fijo doctor → recurso: ninguna transacción espera un doctor teniendo
        // ya un recurso, así que no puede formarse un ciclo (deadlock).
        await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [LOCK_NS_DOCTOR, a.doctorId]);
        if (a.resourceId !== null) {
          await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [LOCK_NS_RECURSO, a.resourceId]);
        }

        const conflict = await client.query<{ id: number }>(
          `SELECT c.id
           FROM ${t("citas")} c
           WHERE c.estado IN ${ACTIVE_STATES}
             AND c.fecha_hora_inicio < $4
             AND c.fecha_hora_fin    > $3
             AND (c.doctor_id = $1::int OR ($2::int IS NOT NULL AND c.recurso_id = $2::int))
           LIMIT 1`,
          [a.doctorId, a.resourceId, a.start, a.end],
        );
        if (conflict.rows.length) {
          throw new VetError("SLOT_TAKEN", "Otro paciente acaba de reservar ese bloque");
        }

        const patientId = await upsertPatient(client, a);

        const inserted = await client.query<{ id: number }>(
          `INSERT INTO ${t("citas")}
             (paciente_id, doctor_id, especialidad_id, recurso_id, fecha_hora_inicio, fecha_hora_fin, notas, estado, origen)
           SELECT $1, $2, e.id, $4, $5, $6, $7, 'confirmada', $8
           FROM ${t("especialidades")} e
           WHERE e.codigo = $3
           RETURNING id`,
          [patientId, a.doctorId, a.specialty, a.resourceId, a.start, a.end, a.notes, a.origin ?? "panel"],
        );
        if (!inserted.rows.length) {
          throw new Error(`La especialidad '${a.specialty}' no existe en la tabla especialidades`);
        }

        await client.query("COMMIT");
        return { appointmentId: inserted.rows[0].id, patientId };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
          broken = true; // conexión inutilizable: se descarta en vez de devolverla al pool
        });
        if (pgCode(err) === "55P03") {
          throw new VetError("BUSY_RETRY", "La agenda está siendo modificada, intenta de nuevo en unos segundos");
        }
        throw err;
      } finally {
        client.release(broken);
      }
    },
  };

  async function upsertPatient(client: PoolClient, a: NewAppointment): Promise<number> {
    const p = a.patient;
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO ${t("pacientes")} (telefono, nombre, es_menor, nombre_acudiente, telefono_acudiente)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (telefono) DO UPDATE SET
         nombre             = EXCLUDED.nombre,
         es_menor           = EXCLUDED.es_menor,
         nombre_acudiente   = EXCLUDED.nombre_acudiente,
         telefono_acudiente = EXCLUDED.telefono_acudiente
       RETURNING id`,
      [p.telefono, p.nombre, Boolean(p.esMenor), p.nombreAcudiente ?? null, p.telefonoAcudiente ?? null],
    );
    return rows[0].id;
  }
}

function toShift(dias: string, horaInicio: string, horaFin: string): WeeklyShift {
  return {
    weekdays: dias
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    openMinute: parseHHMM(horaInicio),
    closeMinute: parseHHMM(horaFin),
  };
}

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
}

function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(identifier)) throw new Error(`Identificador SQL inválido: ${identifier}`);
  return `"${identifier}"`;
}
