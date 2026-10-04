import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { MENSAJE_LIMITE_OPERADORES, esErrorLimiteBd, isPlanError, type Modulo, type PlanErrorCode } from "../domain/plan";
import type { PlanService } from "../application/plan-service";

/** 403 y no 402: los clientes HTTP tratan 402 de forma irregular y el panel ya maneja 403. */
const STATUS: Record<PlanErrorCode, number> = {
  MODULO_PREMIUM: 403,
  LIMITE_OPERADORES: 403,
  PRUEBA_NO_DISPONIBLE: 409,
  MODULO_INVALIDO: 400,
};

interface ConSesion {
  session?: { usuario?: { id?: number } };
}

/**
 * Traduce errores del plan (y la excepción del trigger de Postgres) a { error, mensaje, modulo? }.
 * Devuelve true si respondió; así las rutas legadas de adminApi.js pueden reutilizarlo.
 */
export function responderErrorPlan(err: unknown, res: Response): boolean {
  if (isPlanError(err)) {
    res.status(STATUS[err.code]).json({ error: err.code, mensaje: err.message, ...(err.modulo ? { modulo: err.modulo } : {}) });
    return true;
  }
  if (esErrorLimiteBd(err)) {
    res.status(403).json({ error: "LIMITE_OPERADORES", mensaje: MENSAJE_LIMITE_OPERADORES });
    return true;
  }
  return false;
}

export function crearMiddlewares(service: PlanService) {
  return {
    /** Corta la petición con 403 MODULO_PREMIUM si el módulo no está contratado ni en prueba. */
    requireModulo(modulo: Modulo): RequestHandler {
      return async (_req: Request, res: Response, next: NextFunction) => {
        try {
          await service.exigirModulo(modulo);
          next();
        } catch (err) {
          if (!responderErrorPlan(err, res)) next(err);
        }
      };
    },
  };
}

/**
 *   GET  /          → EstadoPlan (cualquier rol con sesión)
 *   POST /pruebas   { modulo } → 201 EstadoPlan   (authorizeIniciarPrueba, p. ej. solo dirección)
 */
export function planRouter(service: PlanService, opts: { authorizeIniciarPrueba?: RequestHandler } = {}): Router {
  const router = Router();
  const autorizar: RequestHandler[] = opts.authorizeIniciarPrueba ? [opts.authorizeIniciarPrueba] : [];

  router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await service.estado());
    } catch (err) {
      next(err);
    }
  });

  router.post("/pruebas", ...autorizar, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usuarioId = (req as Request & ConSesion).session?.usuario?.id ?? null;
      const modulo = (req.body as { modulo?: unknown } | undefined)?.modulo;
      res.status(201).json(await service.iniciarPrueba(modulo, usuarioId));
    } catch (err) {
      if (!responderErrorPlan(err, res)) next(err);
    }
  });

  return router;
}
