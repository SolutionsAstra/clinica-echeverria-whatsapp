import type { Pool } from "pg";
import { isSpecialty, SPECIALTY_RULES } from "../../vet";
import { BLOQUES, type Bloque } from "../domain/derivacion";
import type { DerivacionesRepository, DerivacionRow, Logger } from "../application/ports";

/**
 * Adaptador PostgreSQL (Supabase) de la bandeja de derivaciones.
 *
 * CONCURRENCIA: `reclamar` es un único UPDATE condicional. Postgres toma el
 * bloqueo de fila y reevalúa el WHERE tras esperar, así que si dos recepcionistas
 * pulsan "Reservar" a la vez, solo una obtiene la fila (la otra recibe 0 filas).
 *
 * RECLAMO VENCIDO: si el proceso muere entre reclamar y cerrar, la derivación
 * reaparece en la bandeja tras RECLAMO_EXPIRA_SEG. vet.book tarda como máximo
 * unos segundos (lock_timeout = 5s), por lo que 2 minutos es holgado.
 *
 * LECTURA TOLERANTE: se lee `d.*` y se traduce cada fila aceptando snake_case
 * (paciente_nombre | nombre_paciente, capturada_en | created_at) y camelCase. Una fila
 * incompleta se omite con un log; nunca tumba la bandeja con un 500.
 */
export const RECLAMO_EXPIRA_SEG = 120;
const LIMITE_BANDEJA = 500;

type FilaDb = Record<string, unknown>;

/** Primer valor no vacío entre los alias de una columna. */
function columna(r: FilaDb, ...nombres: string[]): unknown {
  for (const n of nombres) {
    const v = r[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const comoTexto = (v: unknown): string | null => (v === undefined || v === null ? null : String(v).trim() || null);

function comoFecha(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** DATE de Postgres: node-pg lo entrega como Date a medianoche LOCAL, o como texto si hay type parser. */
function comoDia(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "string") return /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? null;
  return null;
}

export function createPgDerivacionesRepository(
  getPool: () => Promise<Pool>,
  options: { schema?: string; logger?: Logger } = {},
): DerivacionesRepository {
  const s = quoteIdent(options.schema ?? "public");
  const t = (table: string) => `${s}.${quoteIdent(table)}`;
  const log = options.logger ?? console;

  function mapRow(r: FilaDb): DerivacionRow | null {
    const id = Number(columna(r, "id"));
    const especialidad = comoTexto(columna(r, "especialidad", "especialidad_codigo", "especialidadCodigo"));
    const bloque = comoTexto(columna(r, "bloque", "bloque_preferido", "bloquePreferido"));
    const pacienteNombre = comoTexto(columna(r, "paciente_nombre", "nombre_paciente", "pacienteNombre", "nombrePaciente"));
    const telefono = comoTexto(columna(r, "telefono"));
    const doctorId = Number(columna(r, "doctor_id", "doctorId"));
    const fechaPreferida = comoDia(columna(r, "fecha_preferida", "fechaPreferida"));
    const capturadaEn = comoFecha(columna(r, "capturada_en", "created_at", "capturadaEn", "createdAt"));

    if (
      !Number.isInteger(id) ||
      !isSpecialty(especialidad) ||
      !BLOQUES.includes(bloque as Bloque) ||
      !pacienteNombre ||
      !telefono ||
      !Number.isInteger(doctorId) ||
      !fechaPreferida ||
      !capturadaEn
    ) {
      log.error(`[derivaciones] Fila ${String(r.id)} incompleta o con especialidad/bloque desconocidos; se omite`, especialidad, bloque);
      return null;
    }

    return {
      id,
      telefono,
      pacienteNombre,
      nombreAcudiente: comoTexto(columna(r, "nombre_acudiente", "nombreAcudiente")),
      especialidad,
      doctorId,
      doctorNombre: comoTexto(columna(r, "doctor_nombre", "doctorNombre")) ?? "",
      bloque: bloque as Bloque,
      fechaPreferida,
      notas: comoTexto(columna(r, "notas")),
      capturadaEn,
    };
  }

  const validas = (rows: FilaDb[]) => rows.map(mapRow).filter((r): r is DerivacionRow => r !== null);

  return {
    async listarPendientes() {
      const pool = await getPool();
      const { rows } = await pool.query<FilaDb>(
        `SELECT d.*, doc.nombre AS doctor_nombre
         FROM ${t("derivaciones")} d
         JOIN ${t("doctores")} doc ON doc.id = d.doctor_id
         WHERE d.estado = 'pendiente' OR (d.estado = 'en_proceso' AND d.reclamada_en < now() - make_interval(secs => $1))
         ORDER BY d.id ASC
         LIMIT ${LIMITE_BANDEJA}`,
        [RECLAMO_EXPIRA_SEG],
      );
      // Orden de la bandeja: la más antigua primero. Se ordena aquí para no depender del nombre de la columna.
      return validas(rows).sort((a, b) => a.capturadaEn.getTime() - b.capturadaEn.getTime() || a.id - b.id);
    },

    async reclamar(id: number, usuarioId: number) {
      const pool = await getPool();
      const { rows } = await pool.query<FilaDb>(
        `WITH r AS (
           UPDATE ${t("derivaciones")}
           SET estado = 'en_proceso', reclamada_en = now(), reclamada_por = $2
           WHERE id = $1 AND (estado = 'pendiente' OR (estado = 'en_proceso' AND reclamada_en < now() - make_interval(secs => $3)))
           RETURNING *
         )
         SELECT r.*, doc.nombre AS doctor_nombre
         FROM r JOIN ${t("doctores")} doc ON doc.id = r.doctor_id`,
        [id, usuarioId, RECLAMO_EXPIRA_SEG],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async existe(id: number) {
      const pool = await getPool();
      const { rows } = await pool.query(`SELECT 1 FROM ${t("derivaciones")} WHERE id = $1`, [id]);
      return rows.length > 0;
    },

    async liberar(id: number) {
      const pool = await getPool();
      await pool.query(
        `UPDATE ${t("derivaciones")}
         SET estado = 'pendiente', reclamada_en = NULL, reclamada_por = NULL
         WHERE id = $1 AND estado = 'en_proceso'`,
        [id],
      );
    },

    async marcarReservada(id: number, citaId: number, usuarioId: number) {
      const pool = await getPool();
      const { rowCount } = await pool.query(
        `UPDATE ${t("derivaciones")}
         SET estado = 'reservada', cita_id = $2, reservada_en = now(), reservada_por = $3
         WHERE id = $1 AND estado = 'en_proceso'`,
        [id, citaId, usuarioId],
      );
      if (!rowCount) throw new Error(`La derivación ${id} no estaba en_proceso al cerrarla`);
    },

    async marcarNotificacion(id: number, error: string | null) {
      const pool = await getPool();
      await pool.query(
        `UPDATE ${t("derivaciones")}
         SET notificado_en = CASE WHEN $2::text IS NULL THEN now() ELSE NULL END,
             notificacion_error = $2::text
         WHERE id = $1`,
        [id, error],
      );
    },

    async registrar(d) {
      const pool = await getPool();
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO ${t("derivaciones")}
           (telefono, paciente_nombre, nombre_acudiente, especialidad, doctor_id, bloque, fecha_preferida, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
         RETURNING id`,
        [d.telefono, d.pacienteNombre, d.nombreAcudiente, d.especialidad, d.doctorId, d.bloque, d.fechaPreferida, d.notas],
      );
      return rows[0].id;
    },

    async horarioOcupado({ doctorId, especialidad, inicio, fin }) {
      const pool = await getPool();
      const tipoRecurso = SPECIALTY_RULES[especialidad].resourceType;
      // Estados activos: mantener alineado con ACTIVE_STATES de pg-scheduling-repository.
      // El recurso se resuelve igual que resourceIdFor (primer id del tipo).
      const { rows } = await pool.query(
        `SELECT 1
         FROM ${t("citas")} c
         WHERE c.estado = 'confirmada'
           AND c.fecha_hora_inicio < $3
           AND c.fecha_hora_fin    > $2
           AND (
             c.doctor_id = $1::int
             OR ($4::text IS NOT NULL AND c.recurso_id = (
               SELECT r.id FROM ${t("recursos")} r WHERE r.tipo = $4::text ORDER BY r.id LIMIT 1))
           )
         LIMIT 1`,
        [doctorId, inicio, fin, tipoRecurso],
      );
      return rows.length > 0;
    },
  };
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) throw new Error(`Nombre de schema/tabla no permitido: ${name}`);
  return `"${name}"`;
}