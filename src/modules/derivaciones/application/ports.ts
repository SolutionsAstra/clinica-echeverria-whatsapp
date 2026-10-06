import type { Specialty, VetScheduler } from "../../vet";
import type { Bloque } from "../domain/derivacion";

/** Derivación tal como la entrega el repositorio (ya validada y tipada). */
export interface DerivacionRow {
  id: number;
  telefono: string;
  pacienteNombre: string;
  nombreAcudiente: string | null;
  especialidad: Specialty;
  doctorId: number;
  doctorNombre: string;
  bloque: Bloque;
  fechaPreferida: string; // YYYY-MM-DD
  notas: string | null;
  capturadaEn: Date;
}

export interface NuevaDerivacion {
  telefono: string;
  pacienteNombre: string;
  nombreAcudiente: string | null;
  especialidad: Specialty;
  doctorId: number;
  bloque: Bloque;
  fechaPreferida: string;
  notas: string | null;
}

/**
 * Persistencia de la bandeja. Máquina de estados:
 *   pendiente ──reclamar──▶ en_proceso ──marcarReservada──▶ reservada
 *                  ▲             │
 *                  └──liberar────┘   (o reclamo vencido)
 */
export interface DerivacionesRepository {
  /** Pendientes (y reclamos vencidos), de la más antigua a la más reciente. */
  listarPendientes(): Promise<DerivacionRow[]>;
  /** Paso atómico pendiente → en_proceso. null si no existe o ya la tomó otra persona. */
  reclamar(id: number, usuarioId: number | null): Promise<DerivacionRow | null>;
  existe(id: number): Promise<boolean>;
  /** Compensación: en_proceso → pendiente. */
  liberar(id: number): Promise<void>;
  marcarReservada(id: number, citaId: number, usuarioId: number | null): Promise<void>;
  /** error = null → enviada. */
  marcarNotificacion(id: number, error: string | null): Promise<void>;
  registrar(input: NuevaDerivacion): Promise<number>;
    /**
   * ¿Existe una cita activa que choque con [inicio, fin) para ese doctor o para el recurso
   * físico de la especialidad? Se usa para clasificar un rechazo de vet.book como conflicto.
   */
  horarioOcupado(q: { doctorId: number; especialidad: Specialty; inicio: Date; fin: Date }): Promise<boolean>;
}

/** Solo necesitamos `book` del módulo VET: dependemos de la interfaz, no de la implementación. */
export type Booker = Pick<VetScheduler, "book">;

/** Compatible con `src/whatsapp.js` (`wa.enviarTexto`). */
export interface Notifier {
  enviarTexto(to: string, texto: string): Promise<unknown>;
}

export interface Logger {
  error(...args: unknown[]): void;
}
