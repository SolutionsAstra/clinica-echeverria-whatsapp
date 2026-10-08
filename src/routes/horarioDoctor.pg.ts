// routes/horarioDoctor.pg.ts
// Lee de Supabase los turnos del doctor PARA la especialidad pedida.
// Devuelve las filas sin normalizar: citaManual.routes.ts las interpreta con parseDias/parseHora,
// que toleran CSV o INT[] en `dias` y CHAR(5) o TIME en las horas.

import type { Pool } from "pg";
import type { LectorHorarioDoctor, TurnoCrudo } from "./citaManual.routes";

const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

export function createPgLectorHorarioDoctor(
  getPool: () => Promise<Pool>,
  { schema = "public" }: { schema?: string } = {},
): LectorHorarioDoctor {
  if (!IDENTIFICADOR.test(schema)) throw new Error(`[horario-doctor] esquema inválido: ${schema}`);
  const t = (tabla: string) => `"${schema}"."${tabla}"`;

  return async ({ doctorId, especialidad }) => {
    const pool = await getPool();
    const { rows } = await pool.query<{ dias: unknown; hora_inicio: string | null; hora_fin: string | null }>(
      `SELECT h.dias,
              h.hora_inicio::text AS hora_inicio,
              h.hora_fin::text    AS hora_fin
       FROM ${t("doctores")} d
       JOIN ${t("doctor_especialidad")} de ON de.doctor_id = d.id
       JOIN ${t("especialidades")} e      ON e.id = de.especialidad_id
       LEFT JOIN ${t("horarios_disponibilidad")} h ON h.doctor_id = d.id
       WHERE d.id = $1 AND e.codigo = $2 AND d.activo
       ORDER BY h.id`,
      [doctorId, especialidad],
    );
    if (!rows.length) return null; // inexistente, inactivo o sin esa especialidad
    return rows
      .filter((r) => r.dias != null && r.hora_inicio != null && r.hora_fin != null)
      .map<TurnoCrudo>((r) => ({ dias: r.dias, horaInicio: r.hora_inicio, horaFin: r.hora_fin }));
  };
}