import type { Interval } from "../domain/slots";
import type { Specialty } from "../domain/specialty";

/**
 * Lectura de la agenda ocupada. El adaptador MSSQL vive en infrastructure/;
 * los tests usan un adaptador en memoria.
 */
export interface BusyAgenda {
  /** Intervalos ocupados de la especialidad que se solapan con [from, to). */
  busyBetween(specialty: Specialty, from: Date, to: Date): Promise<Interval[]>;
}

export type Clock = () => Date;
