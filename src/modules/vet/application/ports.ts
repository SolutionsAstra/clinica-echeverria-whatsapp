import type { Interval } from "../domain/slots";
import type { WeeklyShift } from "../domain/schedule";
import type { Specialty } from "../domain/specialty";

/** Doctor activo habilitado para una especialidad, con sus turnos semanales. */
export interface Provider {
  doctorId: number;
  doctorName: string;
  shifts: WeeklyShift[];
}

/** Cita existente que bloquea a un doctor y/o a un recurso físico. */
export interface BusyBlock extends Interval {
  doctorId: number;
  resourceId: number | null;
}

export interface PatientInput {
  telefono: string;
  nombre: string;
  esMenor?: boolean;
  nombreAcudiente?: string | null;
  telefonoAcudiente?: string | null;
}

export interface NewAppointment {
  specialty: Specialty;
  doctorId: number;
  resourceId: number | null;
  start: Date;
  end: Date;
  patient: PatientInput;
  notes: string | null;
}

/**
 * Acceso a datos que necesita el módulo VET. El adaptador MSSQL vive en
 * infrastructure/; los tests usan uno en memoria.
 */
export interface SchedulingRepository {
  /** Doctores activos de la especialidad, ordenados por prioridad (id ascendente). */
  providersFor(specialty: Specialty): Promise<Provider[]>;
  /** id de `recursos` para un tipo ('equipo_eeg', 'consultorio_neurologia'…), o null si no existe. */
  resourceIdFor(resourceType: string): Promise<number | null>;
  /** Citas activas que se solapan con [from, to) de esos doctores O de ese recurso. */
  busyBetween(query: {
    doctorIds: number[];
    resourceId: number | null;
    from: Date;
    to: Date;
  }): Promise<BusyBlock[]>;
  /**
   * Inserta la cita solo si doctor y recurso siguen libres, de forma atómica.
   * Lanza VetError("SLOT_TAKEN") si alguien reservó primero.
   */
  insertIfFree(appointment: NewAppointment): Promise<{ appointmentId: number; patientId: number }>;
}

export type Clock = () => Date;
