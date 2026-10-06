/**
 * Interfaz pública del módulo VET. Cualquier consumidor (server.js, jobs,
 * tests de integración) importa SOLO desde aquí.
 */
export { createVetModule } from "./vet.module";
export type { VetModule, VetModuleDeps } from "./vet.module";
export { createVetScheduler, DEFAULT_VET_CONFIG } from "./application/vet-scheduler";
export type {
  VetScheduler,
  VetConfig,
  Availability,
  AvailableDay,
  AvailableSlot,
  BookingRequest,
  Booking,
} from "./application/vet-scheduler";
export type { SchedulingRepository, Provider, BusyBlock, PatientInput, NewAppointment, Clock, BookingOrigin } from "./application/ports";
export { SPECIALTIES, SPECIALTY_RULES, SPECIALTY_DURATION_MIN, isSpecialty, parseSpecialty } from "./domain/specialty";
export type { Specialty } from "./domain/specialty";
export type { DayLabel } from "./domain/vet-window";
export { VetError, isVetError } from "./domain/errors";
export type { VetErrorCode } from "./domain/errors";
export { requireApiKey } from "./http/api-key.middleware";
