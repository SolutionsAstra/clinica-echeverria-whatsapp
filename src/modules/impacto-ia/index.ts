/** Interfaz pública del módulo de impacto del agendamiento con IA y métricas premium de Reportes. */
export { createImpactoIaModule } from "./http/impacto-ia.module";
export { parsearTarifas } from "./domain/premium";
export type { ImpactoIaModule, ImpactoIaModuleDeps } from "./http/impacto-ia.module";
export type { ImpactoIaDto, ImpactoIaService, PremiumDto, ResumenVentana } from "./application/impacto-service";
export type { MetricasPremium, Tarifas } from "./domain/premium";