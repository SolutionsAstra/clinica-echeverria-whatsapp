import type { Pool } from "pg";
import type { Router } from "express";
import { createImpactoIaService, type EstadoModuloIa, type ImpactoIaService } from "../application/impacto-service";
import { createPgImpactoRepository } from "../infrastructure/pg-impacto-repository";
import { impactoIaRouter } from "../http/impacto.router";
import type { PruebaFechas } from "../domain/impacto";
import type { Tarifas } from "../domain/premium";

export interface ImpactoIaModuleDeps {
  getPool: () => Promise<Pool>;
  schema?: string;
  pruebaAgendamiento: () => Promise<PruebaFechas | null>;
  estadoModulo: () => Promise<EstadoModuloIa>;
  esFueraDeHorario: (fecha: Date) => boolean;
  /** Reportes contratado o en prueba: habilita `premium` en GET /api/impacto-ia. */
  reportesHabilitado?: () => Promise<boolean>;
  tarifas?: Tarifas;
}

export interface ImpactoIaModule {
  service: ImpactoIaService;
  router: Router;
}

export function createImpactoIaModule(deps: ImpactoIaModuleDeps): ImpactoIaModule {
  const service = createImpactoIaService({
    repository: createPgImpactoRepository(deps.getPool, { schema: deps.schema }),
    pruebaAgendamiento: deps.pruebaAgendamiento,
    estadoModulo: deps.estadoModulo,
    esFueraDeHorario: deps.esFueraDeHorario,
    reportesHabilitado: deps.reportesHabilitado,
    tarifas: deps.tarifas,
  });
  return { service, router: impactoIaRouter(service) };
}