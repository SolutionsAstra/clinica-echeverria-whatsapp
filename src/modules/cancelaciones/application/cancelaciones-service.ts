import { isSpecialty, type Booking, type PatientInput, type Specialty, type VetScheduler } from "../../vet";
import {
  ANTICIPACION_MINIMA_HORAS,
  LIMITE_REAGENDAMIENTOS_IA,
  decidirCancelacion,
  esIntencion,
  horasRestantes,
  type MotivoEscalada,
} from "../domain/politica";
import { CancelacionError } from "../domain/errors";

export type Booker = Pick<VetScheduler, "book">;

export interface CitaParaCancelar {
  citaId: number;
  estado: string;
  especialidad: Specialty;
  pacienteNombre: string;
  reagendamientosUsados: number;
  /** fecha_hora_inicio - now(), calculado por Postgres. */
  segundosHastaInicio: number;
}

export type CupoReagendamiento =
  | { ok: true; paciente: Omit<PatientInput, "telefono">; usados: number }
  | { ok: false; motivo: "LIMITE" | "NO_PERMITIDO" };

export interface CancelacionesRepository {
  leerCita(q: { citaId: number; telefono: string }): Promise<CitaParaCancelar | null>;
  /** UPDATE atómico: solo cancela si sigue confirmada y faltan >= minHoras. */
  cancelarSiAnticipada(q: { citaId: number; telefono: string; minHoras: number }): Promise<boolean>;
  /** UPDATE atómico del contador: solo suma si usados < limite y la cita anterior es válida. */
  reclamarCupoReagendamiento(q: { telefono: string; citaAnteriorId: number; especialidad: Specialty; limite: number }): Promise<CupoReagendamiento>;
  /** Compensación si la reserva nueva falla. */
  liberarCupoReagendamiento(telefono: string): Promise<void>;
  enlazarReagendamiento(q: { citaNuevaId: number; citaAnteriorId: number }): Promise<void>;
}

export type ResultadoCancelacion =
  | { resultado: "escalar"; motivo: MotivoEscalada; horasDeAnticipacion: number | null }
  | {
      resultado: "cancelada";
      citaId: number;
      especialidad: Specialty;
      pacienteNombre: string;
      reagendamientosUsados: number;
      puedeReagendar: boolean;
    };

export interface ResultadoReagendamiento extends Booking {
  citaAnteriorId: number;
  reagendamientosUsados: number;
}

export interface CancelacionesService {
  /** { telefono, citaId, intencion: 'cancelar' | 'reagendar' } */
  cancelar(input: unknown): Promise<ResultadoCancelacion>;
  /** { telefono, citaAnteriorId, especialidad, doctorId, inicio, notas? } */
  reagendar(input: unknown): Promise<ResultadoReagendamiento>;
}

const comoObjeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const telefonoValido = (v: unknown): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return /^\d{11,15}$/.test(d) ? d : null;
};

const enteroPositivo = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

export function createCancelacionesService(deps: {
  repository: CancelacionesRepository;
  scheduler: Booker;
  /** Módulo premium agendamiento_ia vigente (contrato o prueba). Lo decide el servidor, no el bot. */
  agendamientoIaHabilitado: () => Promise<boolean>;
  logger?: { error: (...args: unknown[]) => void };
}): CancelacionesService {
  const repo = deps.repository;
  const log = deps.logger ?? console;

  return {
    async cancelar(input) {
      const b = comoObjeto(input);
      const telefono = telefonoValido(b.telefono);
      const citaId = enteroPositivo(b.citaId);
      const intencion = b.intencion ?? "cancelar";
      if (!telefono || !citaId || !esIntencion(intencion)) {
        throw new CancelacionError("INVALID_INPUT", "telefono, citaId e intencion ('cancelar' | 'reagendar') son obligatorios");
      }

      // Plan básico: no se lee ni se toca la cita; se escala tal cual.
      const premium = await deps.agendamientoIaHabilitado();
      if (!premium) return { resultado: "escalar", motivo: "PLAN_BASICO", horasDeAnticipacion: null };

      const cita = await repo.leerCita({ citaId, telefono });
      if (!cita) throw new CancelacionError("NOT_FOUND", "La cita no existe o no pertenece a este número");
      if (cita.estado !== "confirmada") throw new CancelacionError("CITA_NO_ACTIVA", "La cita ya no está confirmada");

      const decision = decidirCancelacion({
        premium,
        segundosHastaInicio: cita.segundosHastaInicio,
        intencion,
        reagendamientosUsados: cita.reagendamientosUsados,
      });
      if (decision.tipo === "escalar") {
        return { resultado: "escalar", motivo: decision.motivo, horasDeAnticipacion: horasRestantes(cita.segundosHastaInicio) };
      }

      // La regla de 48 h se vuelve a exigir dentro del UPDATE: cubre la carrera con el reloj.
      const cancelada = await repo.cancelarSiAnticipada({ citaId, telefono, minHoras: ANTICIPACION_MINIMA_HORAS });
      if (!cancelada) {
        const actual = await repo.leerCita({ citaId, telefono });
        if (actual?.estado === "confirmada") {
          return { resultado: "escalar", motivo: "MENOS_DE_48H", horasDeAnticipacion: horasRestantes(actual.segundosHastaInicio) };
        }
        throw new CancelacionError("CITA_NO_ACTIVA", "La cita cambió de estado mientras se procesaba");
      }

      return {
        resultado: "cancelada",
        citaId,
        especialidad: cita.especialidad,
        pacienteNombre: cita.pacienteNombre,
        reagendamientosUsados: cita.reagendamientosUsados,
        puedeReagendar: cita.reagendamientosUsados < LIMITE_REAGENDAMIENTOS_IA,
      };
    },

    async reagendar(input) {
      const b = comoObjeto(input);
      const telefono = telefonoValido(b.telefono);
      const citaAnteriorId = enteroPositivo(b.citaAnteriorId);
      const doctorId = enteroPositivo(b.doctorId);
      const especialidad = b.especialidad;
      const inicio = typeof b.inicio === "string" ? b.inicio : "";
      const notas = typeof b.notas === "string" ? b.notas : null;
      if (!telefono || !citaAnteriorId || !doctorId || !isSpecialty(especialidad) || !inicio) {
        throw new CancelacionError("INVALID_INPUT", "telefono, citaAnteriorId, especialidad, doctorId e inicio son obligatorios");
      }
      if (!(await deps.agendamientoIaHabilitado())) {
        throw new CancelacionError("MODULO_PREMIUM", "El reagendamiento automático requiere el módulo agendamiento_ia");
      }

      // 1) Reclamar el cupo (atómico). Dos peticiones simultáneas: solo una pasa.
      const cupo = await repo.reclamarCupoReagendamiento({ telefono, citaAnteriorId, especialidad, limite: LIMITE_REAGENDAMIENTOS_IA });
      if (!cupo.ok) {
        throw cupo.motivo === "LIMITE"
          ? new CancelacionError("LIMITE_REAGENDAMIENTO", `El paciente ya usó su reagendamiento automático (${LIMITE_REAGENDAMIENTOS_IA})`)
          : new CancelacionError("REAGENDAMIENTO_NO_PERMITIDO", "La cita anterior no fue cancelada por el asistente, no es de este paciente o ya se reagendó");
      }

      // 2) Reservar con el mismo motor VET. Los datos del paciente salen de la BD, no del bot.
      let booking: Booking;
      try {
        booking = await deps.scheduler.book({
          specialty: especialidad,
          doctorId,
          start: inicio,
          patient: { telefono, ...cupo.paciente },
          notes: notas,
          origin: "ia",
        });
      } catch (err) {
        await repo.liberarCupoReagendamiento(telefono).catch((e: unknown) => log.error("[cancelaciones] No se pudo liberar el cupo:", e));
        throw err;
      }

      // 3) Trazabilidad: si falla, la cita ya existe y el contador ya cuenta; solo se registra.
      try {
        await repo.enlazarReagendamiento({ citaNuevaId: booking.appointmentId, citaAnteriorId });
      } catch (e) {
        log.error("[cancelaciones] No se pudo enlazar el reagendamiento:", e);
      }

      return { ...booking, citaAnteriorId, reagendamientosUsados: cupo.usados };
    },
  };
}