/**
 * Integración contra la BD real (Supabase): la tabla `especialidades` que dejó
 * la migración debe coincidir 1:1 con SPECIALTY_RULES.
 *
 * Solo corre con RUN_DB_TESTS=true y DATABASE_URL definido:
 *   RUN_DB_TESTS=true npx jest specialty-durations.db
 */
import { getPool, closePool } from "../../../db";
import { assertDurationMatches, isSpecialty, SPECIALTIES } from "../domain/specialty";

const conBd = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);

(conBd ? describe : describe.skip)("Migración Supabase ↔ SPECIALTY_RULES", () => {
  let filas: { codigo: string; duracion_min: number }[] = [];

  beforeAll(async () => {
    const pool = await getPool();
    ({ rows: filas } = await pool.query("SELECT codigo, duracion_min FROM especialidades ORDER BY codigo"));
  });

  afterAll(() => closePool());

  test("la BD tiene exactamente las mismas especialidades que el código", () => {
    expect(filas.map((f) => f.codigo).sort()).toEqual([...SPECIALTIES].sort());
  });

  test("cada duracion_min coincide con el código", () => {
    for (const f of filas) {
      expect(isSpecialty(f.codigo)).toBe(true);
      expect(() => assertDurationMatches(f.codigo as never, f.duracion_min)).not.toThrow();
    }
  });
});
