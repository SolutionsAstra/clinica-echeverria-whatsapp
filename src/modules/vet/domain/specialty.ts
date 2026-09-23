/**
 * Especialidades del centro médico y su duración estricta de cita.
 * Esta tabla es la única fuente de verdad de las duraciones dentro del módulo VET.
 */
export const SPECIALTY_DURATION_MIN = {
  neurologia: 60,
  encefalograma: 120,
  pediatria: 30,
  estetica: 45,
} as const;

export type Specialty = keyof typeof SPECIALTY_DURATION_MIN;

export const SPECIALTIES = Object.keys(SPECIALTY_DURATION_MIN) as Specialty[];

export function isSpecialty(value: unknown): value is Specialty {
  return typeof value === "string" && value in SPECIALTY_DURATION_MIN;
}

export function durationOf(specialty: Specialty): number {
  return SPECIALTY_DURATION_MIN[specialty];
}
