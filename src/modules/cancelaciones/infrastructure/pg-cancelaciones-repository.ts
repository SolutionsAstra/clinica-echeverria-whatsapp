import type { Pool } from "pg";
import { isSpecialty } from "../../vet";
import type { CancelacionesRepository } from "../application/cancelaciones-service";

const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

export function createPgCancelacionesRepository(
  getPool: () => Promise<Pool>,
  { schema = "public" }: { schema?: string } = {},
): CancelacionesRepository {
  if (!IDENTIFICADOR.test(schema)) throw new Error(`[cancelaciones] esquema inválido: ${schema}`);
  const t = (tabla: string) => `"${schema}"."${tabla}"`;

  return {
    async leerCita({ citaId, telefono }) {
      const pool = await getPool();
      const { rows } = await pool.query<{
        id: number; estado: string; especialidad: string; paciente_nombre: string;
        reagendamientos_ia: number; segundos_hasta_inicio: number;
      }>(
        `SELECT c.id, c.estado, e.codigo AS especialidad, p.nombre AS paciente_nombre, p.reagendamientos_ia,
                EXTRACT(EPOCH FROM (c.fecha_hora_inicio - now()))::int AS segundos_hasta_inicio
         FROM ${t("citas")} c
         JOIN ${t("pacientes")} p      ON p.id = c.paciente_id
         JOIN ${t("especialidades")} e ON e.id = c.especialidad_id
         WHERE c.id = $1 AND p.telefono = $2`,
        [citaId, telefono],
      );
      const r = rows[0];
      if (!r) return null;
      if (!isSpecialty(r.especialidad)) throw new Error(`[cancelaciones] especialidad desconocida en BD: ${r.especialidad}`);
      return {
        citaId: r.id,
        estado: r.estado,
        especialidad: r.especialidad,
        pacienteNombre: r.paciente_nombre,
        reagendamientosUsados: Number(r.reagendamientos_ia),
        segundosHastaInicio: Number(r.segundos_hasta_inicio),
      };
    },

    async cancelarSiAnticipada({ citaId, telefono, minHoras }) {
      const pool = await getPool();
      const { rowCount } = await pool.query(
        `UPDATE ${t("citas")} AS c
         SET estado = 'cancelada', cancelada_en = now(), cancelada_por = 'ia'
         FROM ${t("pacientes")} AS p
         WHERE c.id = $1
           AND p.id = c.paciente_id AND p.telefono = $2
           AND c.estado = 'confirmada'
           AND c.fecha_hora_inicio >= now() + make_interval(hours => $3::int)`,
        [citaId, telefono, minHoras],
      );
      return rowCount === 1;
    },

    async reclamarCupoReagendamiento({ telefono, citaAnteriorId, especialidad, limite }) {
      const pool = await getPool();
      const { rows } = await pool.query<{
        nombre: string; es_menor: boolean; nombre_acudiente: string | null;
        telefono_acudiente: string | null; reagendamientos_ia: number;
      }>(
        `UPDATE ${t("pacientes")} AS p
         SET reagendamientos_ia = p.reagendamientos_ia + 1
         WHERE p.telefono = $1
           AND p.reagendamientos_ia < $3::int
           AND EXISTS (
             SELECT 1
             FROM ${t("citas")} c
             JOIN ${t("especialidades")} e ON e.id = c.especialidad_id
             WHERE c.id = $2
               AND c.paciente_id = p.id
               AND c.estado = 'cancelada'
               AND c.cancelada_por = 'ia'
               AND e.codigo = $4
               AND NOT EXISTS (SELECT 1 FROM ${t("citas")} r WHERE r.reagendada_desde_id = c.id)
           )
         RETURNING p.nombre, p.es_menor, p.nombre_acudiente, p.telefono_acudiente, p.reagendamientos_ia`,
        [telefono, citaAnteriorId, limite, especialidad],
      );
      const r = rows[0];
      if (r) {
        return {
          ok: true,
          usados: Number(r.reagendamientos_ia),
          paciente: {
            nombre: r.nombre,
            esMenor: Boolean(r.es_menor),
            nombreAcudiente: r.nombre_acudiente,
            telefonoAcudiente: r.telefono_acudiente,
          },
        };
      }
      // Diagnóstico para responder el código correcto.
      const { rows: estado } = await pool.query<{ reagendamientos_ia: number }>(
        `SELECT reagendamientos_ia FROM ${t("pacientes")} WHERE telefono = $1`,
        [telefono],
      );
      const usados = Number(estado[0]?.reagendamientos_ia ?? 0);
      return { ok: false, motivo: usados >= limite ? "LIMITE" : "NO_PERMITIDO" };
    },

    async liberarCupoReagendamiento(telefono) {
      const pool = await getPool();
      await pool.query(
        `UPDATE ${t("pacientes")} SET reagendamientos_ia = GREATEST(reagendamientos_ia - 1, 0) WHERE telefono = $1`,
        [telefono],
      );
    },

    async enlazarReagendamiento({ citaNuevaId, citaAnteriorId }) {
      const pool = await getPool();
      await pool.query(`UPDATE ${t("citas")} SET reagendada_desde_id = $2 WHERE id = $1`, [citaNuevaId, citaAnteriorId]);
    },
  };
}