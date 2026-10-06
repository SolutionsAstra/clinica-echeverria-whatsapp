import type { Pool } from "pg";
import type { ImpactoRepository } from "../application/impacto-service";

/** Tope defensivo: una clínica no agenda miles de citas por IA en 14 días. */
const LIMITE = 5000;

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
  };
}