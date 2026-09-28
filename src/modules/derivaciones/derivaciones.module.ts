import type { Pool } from "pg";
import type { Router, RequestHandler } from "express";
import { createDerivacionesService, type DerivacionesService } from "./application/derivaciones-service";
import type { Booker, Logger, Notifier } from "./application/ports";
import { createPgDerivacionesRepository } from "./infrastructure/pg-derivaciones-repository";
import { derivacionesIaRouter, derivacionesRouter } from "./http/derivaciones.router";

export interface DerivacionesModuleDeps {
  /** El mismo getPool() de src/db.ts. */
  getPool: () => Promise<Pool>;
  schema?: string;
  /** vetModule.scheduler: llamada en proceso, sin HTTP ni x-api-key. */
  scheduler: Booker;
  /** require('./whatsapp'): el token de Meta nunca sale del servidor. */
  notifier: Notifier;
  /** Middleware de autorización, p.ej. requireRole('recepcion', 'direccion'). */
  authorize?: RequestHandler;
  logger?: Logger;
}

export interface DerivacionesModule {
  service: DerivacionesService;
  /** Panel (sesión): GET / y POST /:id/reservar */
  router: Router;
  /** Asistente de IA (x-api-key): POST / */
  iaRouter: Router;
}

/** Raíz de composición: repositorio Postgres + servicio + router. */
export function createDerivacionesModule(deps: DerivacionesModuleDeps): DerivacionesModule {
  const repository = createPgDerivacionesRepository(deps.getPool, { schema: deps.schema, logger: deps.logger });
  const service = createDerivacionesService({
    repository,
    scheduler: deps.scheduler,
    notifier: deps.notifier,
    logger: deps.logger,
  });
  return {
    service,
    router: derivacionesRouter(service, { authorize: deps.authorize }),
    iaRouter: derivacionesIaRouter(service),
  };
}
