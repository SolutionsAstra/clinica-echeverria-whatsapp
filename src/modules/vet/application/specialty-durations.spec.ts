import { candidateBlocks } from "../domain/slots";
import { assertDurationMatches, durationOf, SPECIALTIES, type Specialty } from "../domain/specialty";
import { toLocalIso } from "../domain/local-time";
import { VetError } from "../domain/errors";

const TZ = "America/Caracas";
const LUNES = "2026-09-28";
/** Horario general del centro: 08:00–17:00 hora de Caracas. */
const CENTRO = { openMinute: 8 * 60, closeMinute: 17 * 60 };

/**
 * FUENTE DE VERDAD: bloques definidos en la migración de Supabase
 * (tabla `especialidades.duracion_min`). Literales escritos a mano a propósito:
 * nunca se derivan de SPECIALTY_RULES, para que el test pueda discrepar del código.
 */
const MIGRACION: Record<Specialty, number> = {
  neurologia: 60,
  eeg: 120,
  pediatria: 30,
  estetica: 45,
};

/** Rejilla esperada en 08:00–17:00, calculada a mano. */
const REJILLA: [Specialty, number, string, string][] = [
  // especialidad, bloques, inicio del último, fin del último
  ["pediatria", 18, "16:30", "17:00"],
  ["estetica", 12, "16:15", "17:00"],
  ["neurologia", 9, "16:00", "17:00"],
  ["eeg", 4, "14:00", "16:00"], // 16:00 terminaría 18:00: fuera del horario
];

/** Ejecuta fn y devuelve el error lanzado (o falla si no lanza). */
function capturar(fn: () => unknown): VetError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(VetError);
    return e as VetError;
  }
  throw new Error("se esperaba un VetError y no se lanzó nada");
}

const hhmm = (d: Date) => toLocalIso(d, TZ).slice(11, 16);

describe("Duraciones por especialidad (código ↔ migración)", () => {
  test("el código define exactamente las 4 especialidades de la migración", () => {
    expect([...SPECIALTIES].sort()).toEqual(Object.keys(MIGRACION).sort());
  });

  test.each(Object.entries(MIGRACION))("%s dura %s min", (especialidad, minutos) => {
    expect(durationOf(especialidad as Specialty)).toBe(minutos);
  });
});

describe("Rejilla 08:00–17:00 (candidateBlocks)", () => {
  test.each(REJILLA)("%s → %s bloques, último %s–%s", (esp, total, ultimoInicio, ultimoFin) => {
    const bloques = candidateBlocks(LUNES, CENTRO, durationOf(esp), TZ);
    expect(bloques.length).toBe(total);
    expect(hhmm(bloques[0].start)).toBe("08:00");
    expect(hhmm(bloques[total - 1].start)).toBe(ultimoInicio);
    expect(hhmm(bloques[total - 1].end)).toBe(ultimoFin);
  });

  test.each(Object.entries(MIGRACION))(
    "%s: cada bloque dura exactamente %s min, sin huecos ni solapes, y nunca pasa de 17:00",
    (esp, minutos) => {
      const bloques = candidateBlocks(LUNES, CENTRO, minutos, TZ);
      const cierre = new Date(`${LUNES}T17:00:00-04:00`).getTime();
      bloques.forEach((b, i) => {
        expect(b.end.getTime() - b.start.getTime()).toBe(minutos * 60_000);
        expect(b.end.getTime()).toBeLessThanOrEqual(cierre);
        if (i > 0) expect(b.start.getTime()).toBe(bloques[i - 1].end.getTime());
      });
    },
  );

  test("los bloques se anclan a 08:00 de Caracas (12:00 UTC), no a la hora del servidor", () => {
    const [primero] = candidateBlocks(LUNES, CENTRO, 60, TZ);
    expect(primero.start.toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect(toLocalIso(primero.start, TZ)).toBe("2026-09-28T08:00:00-04:00");
  });
});

describe("Duración desalineada en la rejilla → error controlado", () => {
  // Sin esta guarda, 0 o un valor negativo dejan el for en bucle infinito
  // (m += 0) y tumban el proceso: Jest ni siquiera llegaría a reportar el timeout.
  test.each([
    ["cero", 0],
    ["negativa", -30],
    ["NaN (duración ausente en BD)", Number.NaN],
    ["decimal", 37.5],
    ["infinita", Number.POSITIVE_INFINITY],
  ])("duración %s (%s) lanza INVALID_DURATION", (_caso, minutos) => {
    const err = capturar(() => candidateBlocks(LUNES, CENTRO, minutos as number, TZ));
    expect(err.code).toBe("INVALID_DURATION");
  });

  test("una duración mayor que la franja no es error: simplemente no hay bloques", () => {
    expect(candidateBlocks(LUNES, CENTRO, 600, TZ)).toEqual([]);
  });
});

describe("Contrato de duración código ↔ BD (assertDurationMatches)", () => {
  test.each(Object.entries(MIGRACION))("%s con %s min en BD es coherente", (esp, minutos) => {
    expect(() => assertDurationMatches(esp as Specialty, minutos)).not.toThrow();
  });

  test.each([
    ["eeg", 90],
    ["neurologia", 45],
    ["pediatria", 60],
    ["estetica", 30],
  ])("%s con %s min en BD lanza DURATION_MISMATCH", (esp, enBd) => {
    const err = capturar(() => assertDurationMatches(esp as Specialty, enBd as number));
    expect(err.code).toBe("DURATION_MISMATCH");
    expect(err.message).toMatch(new RegExp(`${esp}.*${enBd}.*${MIGRACION[esp as Specialty]}`));
  });

  test("una duración nula en BD (columna vacía) también es incoherente", () => {
    const err = capturar(() => assertDurationMatches("eeg", null as unknown as number));
    expect(err.code).toBe("DURATION_MISMATCH");
  });
});
