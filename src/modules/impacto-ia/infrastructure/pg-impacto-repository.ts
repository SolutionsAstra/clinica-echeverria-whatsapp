import type { Pool } from "pg";
import type { ImpactoRepository } from "../application/impacto-service";
import type { CitaMetrica } from "../domain/premium";

/** Tope defensivo: una clínica no agenda miles de citas en 14 días. */
const LIMITE = 5000;

const comoFecha = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

export function createPgImpactoRepository(getPool: () => Promise<Pool>, { schema = "public" }: { schema?: string } = {}): ImpactoRepository {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error(`[impacto-ia] esquema inválido: ${schema}`);
  const t = (tabla: string) => `"${schema}"."${tabla}"`;

  return {
    async citasIa(desde, hasta) {
      const pool = await getPool();
      const { rows } = await pool.query<{ creado_en: Date }>(
        `SELECT creado_en
         FROM ${t("citas")}
         WHERE origen = 'ia' AND estado <> 'cancelada'
           AND creado_en >= $1 AND creado_en < $2
         ORDER BY creado_en
         LIMIT ${LIMITE}`,
        [desde, hasta],
      );
      return rows.map((r) => r.creado_en);
    },

    async derivaciones(desde, hasta) {
      const pool = await getPool();
      const { rows } = await pool.query<{ capturada_en: Date; reservada_en: Date | null; estado: string }>(
        `SELECT capturada_en, reservada_en, estado
         FROM ${t("derivaciones")}
         WHERE capturada_en >= $1 AND capturada_en < $2
         ORDER BY capturada_en
         LIMIT ${LIMITE}`,
        [desde, hasta],
      );
      return rows.map((r) => ({ capturadaEn: r.capturada_en, reservadaEn: r.reservada_en, estado: r.estado }));
    },

    async citasPeriodo(desde, hasta) {
      const pool = await getPool();
      const { rows } = await pool.query<{
        creado_en: unknown; fecha_hora_inicio: unknown; estado: string; origen: string | null; especialidad: string;
      }>(
        `SELECT c.creado_en, c.fecha_hora_inicio, c.estado, c.origen, e.codigo AS especialidad
         FROM ${t("citas")} c
         JOIN ${t("especialidades")} e ON e.id = c.especialidad_id
         WHERE (c.creado_en >= $1 AND c.creado_en < $2)
            OR (c.fecha_hora_inicio >= $1 AND c.fecha_hora_inicio < $2)
         LIMIT ${LIMITE}`,
        [desde, hasta],
      );
      return rows.flatMap((r): CitaMetrica[] => {
        const creadoEn = comoFecha(r.creado_en);
        const inicio = comoFecha(r.fecha_hora_inicio);
        if (!creadoEn || !inicio) return [];
        return [{ creadoEn, inicio, estado: r.estado, origen: r.origen ?? null, especialidad: r.especialidad }];
      });
    },
  };
}