import { VetError } from "./errors";

/**
 * Especialidades del centro médico. Esta tabla es la ÚNICA fuente de verdad
 * de duraciones y recursos físicos dentro del módulo VET.
 *
 * Los códigos coinciden con `especialidades.codigo` en la BD
 * ('eeg' | 'estetica' | 'pediatria' | 'neurologia').
 *
 * `resourceType` apunta a `recursos.tipo`: toda cita de esa especialidad
 * ocupa ese recurso durante su duración completa, así dos citas de la misma
 * especialidad no pueden compartir sala/equipo aunque las atiendan doctores distintos.
 */
export const SPECIALTY_RULES = {
  pediatria: { durationMin: 30, resourceType: null },
  estetica: { durationMin: 45, resourceType: null },
  neurologia: { durationMin: 60, resourceType: "consultorio_neurologia" },
  eeg: { durationMin: 120, resourceType: "equipo_eeg" },
} as const satisfies Record<string, { durationMin: number; resourceType: string | null }>;

export type Specialty = keyof typeof SPECIALTY_RULES;

export const SPECIALTIES = Object.keys(SPECIALTY_RULES) as Specialty[];

export const SPECIALTY_DURATION_MIN: Readonly<Record<Specialty, number>> = Object.fromEntries(
  SPECIALTIES.map((s) => [s, SPECIALTY_RULES[s].durationMin]),
) as Record<Specialty, number>;

export function isSpecialty(value: unknown): value is Specialty {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SPECIALTY_RULES, value);
}

/** Sinónimos que puede enviar el asistente de IA en texto libre. */
const ALIASES: Record<string, Specialty> = {
  eeg: "eeg",
  encefalograma: "eeg",
  electroencefalograma: "eeg",
  electroencefalografia: "eeg",
  neurologia: "neurologia",
  pediatria: "pediatria",
  estetica: "estetica",
  medicina_estetica: "estetica",
};

/** Normaliza entrada libre ("Electroencefalografía", "Medicina Estética") a un código válido. */
export function parseSpecialty(value: unknown): Specialty | null {
  if (typeof value !== "string") return null;
  const key = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ALIASES[key] ?? null;
}

export function durationOf(specialty: Specialty): number {
  return SPECIALTY_RULES[specialty].durationMin;
}

export function resourceTypeOf(specialty: Specialty): string | null {
  return SPECIALTY_RULES[specialty].resourceType;
}

/**
 * Contrato con la BD: `especialidades.duracion_min` debe coincidir con
 * SPECIALTY_RULES. Si alguien edita la migración o la tabla sin tocar el código
 * (o al revés), se falla en voz alta en vez de agendar con dos reglas distintas.
 */
export function assertDurationMatches(specialty: Specialty, durationInDb: number): void {
  const expected = durationOf(specialty);
  if (durationInDb !== expected) {
    throw new VetError(
      "DURATION_MISMATCH",
      `Especialidad '${specialty}': la BD define ${durationInDb} min y el código ${expected} min`,
    );
  }
}
