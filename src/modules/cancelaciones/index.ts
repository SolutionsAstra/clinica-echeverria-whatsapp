import type { Pool } from "pg";
import type { Router } from "express";
import { createCancelacionesService, type Booker, type CancelacionesService } from "./application/cancelaciones-service";
import { createPgCancelacionesRepository } from "./infrastructure/pg-cancelaciones-repository";
import { cancelacionesIaRouter } from "./http/cancelaciones.router";

export interface CancelacionesModuleDeps {
  getPool: () => Promise<Pool>;
  schema?: string;
  /** vetModule.scheduler: misma instancia, en proceso. */
  scheduler: Booker;
  agendamientoIaHabilitado: () => Promise<boolean>;
  logger?: { error: (...args: unknown[]) => void };
}

export interface CancelacionesModule {
  service: CancelacionesService;
  /** Asistente de IA (x-api-key): POST /cancelar · POST /reagendar */
  iaRouter: Router;
}

export function createCancelacionesModule(deps: CancelacionesModuleDeps): CancelacionesModule {
  const repository = createPgCancelacionesRepository(deps.getPool, { schema: deps.schema });
  const service = createCancelacionesService({
    repository,
    scheduler: deps.scheduler,
    agendamientoIaHabilitado: deps.agendamientoIaHabilitado,
    logger: deps.logger,
  });
  return { service, iaRouter: cancelacionesIaRouter(service) };
}

export { ANTICIPACION_MINIMA_HORAS, LIMITE_REAGENDAMIENTOS_IA, decidirCancelacion } from "./domain/politica";
export type { Intencion, MotivoEscalada, Decision } from "./domain/politica";
export { CancelacionError, isCancelacionError } from "./domain/errors";
export type { CancelacionesService, ResultadoCancelacion, ResultadoReagendamiento } from "./application/cancelaciones-service";