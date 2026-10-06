import type { Pool } from "pg";
import type { RequestHandler, Router } from "express";
import { createPlanService, type PlanService } from "./application/plan-service";
import { createPgPlanRepository } from "./infrastructure/pg-plan-repository";
import { capacidadesIaRouter, crearMiddlewares, planRouter } from "./http/plan.router";
import type { Modulo } from "./domain/plan";

export interface PlanModuleDeps {
  /** El mismo getPool() de src/db.ts. */
  getPool: () => Promise<Pool>;
  schema?: string;
  /** Quién puede activar la prueba gratuita, p. ej. requireRole('direccion'). */
  authorizeIniciarPrueba?: RequestHandler;
}

export interface PlanModule {
  service: PlanService;
  /** Montar con sesión: app.use('/api/plan', requireLogin, planModule.router) */
  router: Router;
  /** Montar con API key: app.use('/api/ia/capacidades', iaApiKey, planModule.capacidadesIaRouter) */
  capacidadesIaRouter: Router;
  requireModulo: (modulo: Modulo) => RequestHandler;
}

export function createPlanModule(deps: PlanModuleDeps): PlanModule {
  const service = createPlanService({ repository: createPgPlanRepository(deps.getPool, { schema: deps.schema }) });
  return {
    service,
    router: planRouter(service, { authorizeIniciarPrueba: deps.authorizeIniciarPrueba }),
    capacidadesIaRouter: capacidadesIaRouter(service),
    requireModulo: crearMiddlewares(service).requireModulo,
  };
}