/**
 * Interfaz pública del módulo VET. Cualquier consumidor (rutas Express,
 * Asistente de WhatsApp, jobs) importa SOLO desde aquí.
 */
export { createVetScheduler, DEFAULT_VET_CONFIG } from "./application/vet-scheduler";
export type {
  VetScheduler,
  VetConfig,
  Availability,
  AvailableDay,
  AvailableSlot,
} from "./application/vet-scheduler";
export type { BusyAgenda, Clock } from "./application/ports";
export { SPECIALTIES, SPECIALTY_DURATION_MIN, isSpecialty } from "./domain/specialty";
export type { Specialty } from "./domain/specialty";
