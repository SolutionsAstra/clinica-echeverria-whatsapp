import type { ConnectionPool } from "mssql";
import type { Router } from "express";
import { createVetScheduler, type VetConfig, type VetScheduler } from "./application/vet-scheduler";
import type { Clock } from "./application/ports";
import { createMssqlSchedulingRepository } from "./infrastructure/mssql/mssql-scheduling-repository";
import { vetRouter } from "./http/vet.router";

export interface VetModuleDeps {
  /** Mismo pool perezoso de src/db.js: el módulo no abre conexiones propias. */
  getPool: () => Promise<ConnectionPool>;
  /** Schema SQL de las tablas de citas. Por defecto 'dbo'. */
  schema?: string;
  clock?: Clock;
  config?: Partial<VetConfig>;
}

export interface VetModule {
  scheduler: VetScheduler;
  router: Router;
}

/** Raíz de composición: conecta el repositorio MSSQL, el servicio y el router. */
export function createVetModule(deps: VetModuleDeps): VetModule {
  const repository = createMssqlSchedulingRepository(deps.getPool, { schema: deps.schema });
  const scheduler = createVetScheduler({ repository, clock: deps.clock, config: deps.config });
  return { scheduler, router: vetRouter(scheduler) };
}
