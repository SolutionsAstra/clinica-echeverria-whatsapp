import type { Pool } from "pg";
import { esModulo, type Contrato, type Prueba } from "../domain/plan";
import type { PlanRepository } from "../application/plan-service";

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;
/** Si la migración aún no corrió, el panel arranca con el plan base en vez de caerse. */
const CONTRATO_BASE: Contrato = { maxOperadores: 2, modulos: [] };
const TABLA_INEXISTENTE = "42P01";

const esTablaInexistente = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === TABLA_INEXISTENTE;

export function createPgPlanRepository(getPool: () => Promise<Pool>, { schema = "public" }: { schema?: string } = {}): PlanRepository {
  if (!IDENTIFICADOR.test(schema)) throw new Error(`[plan] esquema inválido: ${schema}`);
  const t = (tabla: string) => `"${schema}".${tabla}`;

  return {
    async leerContrato() {
      const pool = await getPool();
      try {
        const { rows } = await pool.query<{ max_operadores: number; modulos: string[] }>(
          `SELECT max_operadores, modulos FROM ${t("plan_clinica")} WHERE id = 1`,
        );
        const fila = rows[0];
        return fila ? { maxOperadores: fila.max_operadores, modulos: fila.modulos ?? [] } : CONTRATO_BASE;
      } catch (err) {
        if (esTablaInexistente(err)) return CONTRATO_BASE;
        throw err;
      }
    },

    async contarOperadoresActivos() {
      const pool = await getPool();
      const { rows } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t("usuarios")} WHERE activo`);
      return rows[0]?.n ?? 0;
    },

    async listarPruebas() {
      const pool = await getPool();
      let rows: { modulo: string; iniciada_en: Date; expira_en: Date }[];
      try {
        ({ rows } = await pool.query<{ modulo: string; iniciada_en: Date; expira_en: Date }>(
          `SELECT modulo, iniciada_en, expira_en FROM ${t("plan_pruebas")}`,
        ));
      } catch (err) {
        if (esTablaInexistente(err)) return [];
        throw err;
      }
      return rows
        .filter((r) => esModulo(r.modulo))
        .map((r) => ({ modulo: r.modulo as Prueba["modulo"], iniciadaEn: r.iniciada_en, expiraEn: r.expira_en }));
    },

    async registrarPrueba(prueba, usuarioId) {
      const pool = await getPool();
      const { rowCount } = await pool.query(
        `INSERT INTO ${t("plan_pruebas")} (modulo, iniciada_en, expira_en, iniciada_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (modulo) DO NOTHING`,
        [prueba.modulo, prueba.iniciadaEn, prueba.expiraEn, usuarioId],
      );
      return rowCount === 1;
    },
  };
}
