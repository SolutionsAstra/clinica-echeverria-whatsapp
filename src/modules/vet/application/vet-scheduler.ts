import { addDays, localToInstant, toLocalIso, type LocalDate } from "../domain/local-time";
import { candidateBlocks, overlaps, type Interval } from "../domain/slots";
import { workingHoursOn, type DailyHours } from "../domain/schedule";
import { durationOf, resourceTypeOf, type Specialty } from "../domain/specialty";
import { vetDays, type DayLabel } from "../domain/vet-window";
import { VetError } from "../domain/errors";
import type { BookingOrigin, BusyBlock, Clock, PatientInput, Provider, SchedulingRepository } from "./ports";
export interface VetConfig {
  timeZone: string;
  /** Hora local a partir de la cual "Hoy" sale de la ventana. */
  cutoffHour: number;
  /** Horario general del centro. */
  clinicHours: DailyHours;
}

export const DEFAULT_VET_CONFIG: VetConfig = {
  timeZone: "America/Caracas",
  cutoffHour: 15,
  clinicHours: { openMinute: 8 * 60, closeMinute: 17 * 60 },
};

export interface AvailableSlot {
  /** ISO 8601 con offset local, p.ej. 2026-09-29T08:00:00-04:00 */
  start: string;
  end: string;
  doctorId: number;
  doctorName: string;
}

export interface AvailableDay {
  date: LocalDate;
  label: DayLabel;
  slots: AvailableSlot[];
}

export interface Availability {
  specialty: Specialty;
  durationMin: number;
  timeZone: string;
  generatedAt: string;
  days: AvailableDay[];
}

export interface BookingRequest {
  specialty: Specialty;
  doctorId: number;
  /** Inicio del bloque tal como lo devolvió getAvailability (ISO 8601 con offset). */
  start: string;
  patient: PatientInput;
  notes?: string | null;
    /** 'ia' solo lo indica POST /api/vet/citas (asistente con módulo agendamiento_ia). Por defecto 'panel'. */
  origin?: BookingOrigin;
}

export interface Booking {
  appointmentId: number;
  patientId: number;
  specialty: Specialty;
  doctorId: number;
  doctorName: string;
  resourceId: number | null;
  start: string;
  end: string;
}

export interface VetScheduler {
  getAvailability(specialty: Specialty): Promise<Availability>;
  book(request: BookingRequest): Promise<Booking>;
}

interface OfferedSlot extends Interval {
  /** Doctores libres en este bloque, en orden de prioridad. El primero es el que se ofrece. */
  providers: Provider[];
}

export function createVetScheduler(deps: {
  repository: SchedulingRepository;
  clock?: Clock;
  config?: Partial<VetConfig>;
}): VetScheduler {
  const repo = deps.repository;
  const clock = deps.clock ?? (() => new Date());
  const cfg: VetConfig = { ...DEFAULT_VET_CONFIG, ...deps.config };

  async function resourceIdFor(specialty: Specialty): Promise<number | null> {
    const type = resourceTypeOf(specialty);
    if (!type) return null;
    const id = await repo.resourceIdFor(type);
    if (id === null) {
      // Nunca ofrecer horarios sin poder bloquear el recurso: habría doble reserva.
      throw new VetError("RESOURCE_NOT_CONFIGURED", `No existe un recurso de tipo '${type}' en la tabla recursos`);
    }
    return id;
  }

  /**
   * Calcula la ventana VET completa: por cada día, los bloques futuros en los
   * que el recurso de la especialidad está libre y al menos un doctor habilitado
   * tiene libre su agenda (en cualquier especialidad) y está en turno.
   */
  async function computeWindow(specialty: Specialty, now: Date) {
    const durationMin = durationOf(specialty);
    const days = vetDays(now, cfg.timeZone, cfg.cutoffHour);
    const [providers, resourceId] = await Promise.all([repo.providersFor(specialty), resourceIdFor(specialty)]);

    const from = localToInstant(days[0].date, 0, cfg.timeZone);
    const to = localToInstant(addDays(days[days.length - 1].date, 1), 0, cfg.timeZone);
    const busy: BusyBlock[] = providers.length
      ? await repo.busyBetween({ doctorIds: providers.map((p) => p.doctorId), resourceId, from, to })
      : [];
    const resourceBusy = resourceId === null ? [] : busy.filter((b) => b.resourceId === resourceId);

    const window = days.map((day) => {
      const byStart = new Map<number, OfferedSlot>();
      for (const provider of providers) {
        const doctorBusy = busy.filter((b) => b.doctorId === provider.doctorId);
        for (const hours of workingHoursOn(day.date, cfg.clinicHours, provider.shifts)) {
          for (const block of candidateBlocks(day.date, hours, durationMin, cfg.timeZone)) {
            if (block.start.getTime() <= now.getTime()) continue;
            if (resourceBusy.some((b) => overlaps(block, b))) continue;
            if (doctorBusy.some((b) => overlaps(block, b))) continue;
            const key = block.start.getTime();
            const slot = byStart.get(key) ?? { ...block, providers: [] };
            slot.providers.push(provider);
            byStart.set(key, slot);
          }
        }
      }
      const slots = [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
      return { ...day, slots };
    });

    return { durationMin, resourceId, window };
  }

  return {
    async getAvailability(specialty) {
      const now = clock();
      const { durationMin, window } = await computeWindow(specialty, now);
      return {
        specialty,
        durationMin,
        timeZone: cfg.timeZone,
        generatedAt: toLocalIso(now, cfg.timeZone),
        days: window.map(({ date, label, slots }) => ({
          date,
          label,
          slots: slots.map((s) => ({
            start: toLocalIso(s.start, cfg.timeZone),
            end: toLocalIso(s.end, cfg.timeZone),
            doctorId: s.providers[0].doctorId,
            doctorName: s.providers[0].doctorName,
          })),
        })),
      };
    },

    async book(request) {
      const start = parseInstant(request.start);
      const patient = validatePatient(request.patient);
      const notes = request.notes?.trim() || null;
      if (notes && notes.length > 400) throw new VetError("INVALID_INPUT", "notas supera 400 caracteres");
      if (!Number.isInteger(request.doctorId)) throw new VetError("INVALID_INPUT", "doctorId inválido");

      const now = clock();
      const { resourceId, window } = await computeWindow(request.specialty, now);

      // El bloque debe ser uno de los que la ventana VET vigente considera libres
      // para ese doctor: ventana, rejilla, turno y agenda se validan con la misma lógica.
      const provider = window
        .flatMap((d) => d.slots)
        .find((s) => s.start.getTime() === start.getTime())
        ?.providers.find((p) => p.doctorId === request.doctorId);
      if (!provider) {
        throw new VetError("SLOT_NOT_OFFERED", "El bloque solicitado no está disponible en la ventana VET vigente");
      }

      const end = new Date(start.getTime() + durationOf(request.specialty) * 60000);
      // Revalidación atómica en BD: cubre la carrera entre dos pacientes que eligen el mismo bloque.
      const { appointmentId, patientId } = await repo.insertIfFree({
        specialty: request.specialty,
        doctorId: provider.doctorId,
        resourceId,
        start,
        end,
        patient,
        notes,
        origin: request.origin === "ia" ? "ia" : "panel", // lista blanca: cualquier otro valor cuenta como panel
      });

      return {
        appointmentId,
        patientId,
        specialty: request.specialty,
        doctorId: provider.doctorId,
        doctorName: provider.doctorName,
        resourceId,
        start: toLocalIso(start, cfg.timeZone),
        end: toLocalIso(end, cfg.timeZone),
      };
    },
  };
}

function parseInstant(value: unknown): Date {
  // Se exige offset explícito (Z o ±HH:MM) para no depender del huso del servidor.
  if (typeof value !== "string" || !/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new VetError("INVALID_INPUT", "start debe ser ISO 8601 con offset, p.ej. 2026-09-29T08:00:00-04:00");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new VetError("INVALID_INPUT", "start no es una fecha válida");
  return date;
}

function validatePatient(p: PatientInput | undefined): PatientInput {
  const telefono = p?.telefono?.trim() ?? "";
  const nombre = p?.nombre?.trim() ?? "";
  if (!/^\+?\d{7,15}$/.test(telefono)) throw new VetError("INVALID_INPUT", "paciente.telefono inválido");
  if (nombre.length < 2 || nombre.length > 150) throw new VetError("INVALID_INPUT", "paciente.nombre inválido");
  const nombreAcudiente = p?.nombreAcudiente?.trim() || null;
  const telefonoAcudiente = p?.telefonoAcudiente?.trim() || null;
  // Límites de columna de dbo.pacientes: evitan un 500 por truncamiento en el INSERT.
  if (nombreAcudiente && nombreAcudiente.length > 150) throw new VetError("INVALID_INPUT", "paciente.nombreAcudiente supera 150 caracteres");
  if (telefonoAcudiente && telefonoAcudiente.length > 30) throw new VetError("INVALID_INPUT", "paciente.telefonoAcudiente supera 30 caracteres");
  return { telefono, nombre, esMenor: Boolean(p?.esMenor), nombreAcudiente, telefonoAcudiente };
}
