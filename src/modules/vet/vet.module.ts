import type { Pool } from "pg";
import type { Router } from "express";
import { createVetScheduler, type VetConfig, type VetScheduler } from "./application/vet-scheduler";
import type { Clock } from "./application/ports";
import { createPgSchedulingRepository } from "./infrastructure/postgres/pg-scheduling-repository";
import { vetRouter } from "./http/vet.router";

export interface VetModuleDeps {
  /** El mismo getPool() de src/db.ts: el módulo no abre conexiones propias. */
  getPool: () => Promise<Pool>;
  /** Schema de Postgres donde viven las tablas. Por defecto 'public'. */
  schema?: string;
  clock?: Clock;
  config?: Partial<VetConfig>;
}

export interface VetModule {
  scheduler: VetScheduler;
  router: Router;
}

/** Raíz de composición: conecta el repositorio Postgres, el servicio y el router. */
export function createVetModule(deps: VetModuleDeps): VetModule {
  const repository = createPgSchedulingRepository(deps.getPool, { schema: deps.schema });
  const scheduler = createVetScheduler({ repository, clock: deps.clock, config: deps.config });
  return { scheduler, router: vetRouter(scheduler) };
}
