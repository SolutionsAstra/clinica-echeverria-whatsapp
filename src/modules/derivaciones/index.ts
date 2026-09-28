/** Interfaz pública del módulo de derivaciones: los consumidores importan SOLO desde aquí. */
export { createDerivacionesModule } from "./derivaciones.module";
export type { DerivacionesModule, DerivacionesModuleDeps } from "./derivaciones.module";
export type { DerivacionesService, ReservaResultado } from "./application/derivaciones-service";
export type { SolicitudDto, Bloque } from "./domain/derivacion";
export { DerivacionError, isDerivacionError } from "./domain/errors";
export type { DerivacionErrorCode } from "./domain/errors";
