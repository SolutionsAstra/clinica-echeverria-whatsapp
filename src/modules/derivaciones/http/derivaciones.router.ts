import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { isVetError, type VetErrorCode } from "../../vet";
import { isDerivacionError, type DerivacionErrorCode } from "../domain/errors";
import type { DerivacionesService } from "../application/derivaciones-service";

/** Mismos códigos que /api/vet para que el frontend no distinga el origen. */
const STATUS: Record<VetErrorCode | DerivacionErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  DERIVACION_NO_DISPONIBLE: 409,
  SLOT_NOT_OFFERED: 422,
  BUSY_RETRY: 503,
  RESOURCE_NOT_CONFIGURED: 500,
  INVALID_DURATION: 500,
  DURATION_MISMATCH: 500
};

export function statusPara(err: unknown): number | null {
  return isVetError(err) || isDerivacionError(err) ? STATUS[err.code] : null;
}

/** La sesión la pone express-session en server.js; aquí solo se lee. */
interface ConSesion {
  session?: { usuario?: { id?: number } };
}

export function crearHandlers(service: DerivacionesService) {
  function responderError(err: unknown, res: Response, next: NextFunction): void {
    const status = statusPara(err);
    if (status !== null && (isVetError(err) || isDerivacionError(err))) {
      res.status(status).json({ error: err.code, mensaje: err.message });
      return;
    }
    next(err); // → manejador central de server.js (500 genérico, sin detalles de SQL)
  }

  return {
    listar: (async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.set("Cache-Control", "no-store");
        res.json(await service.listarPendientes());
      } catch (err) {
        responderError(err, res, next);
      }
    }) satisfies RequestHandler,

    reservar: (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const usuarioId = (req as Request & ConSesion).session?.usuario?.id ?? null;
        const resultado = await service.reservar(req.params.id, req.body, { usuarioId });
        res.status(201).json(resultado);
      } catch (err) {
        responderError(err, res, next);
      }
    }) satisfies RequestHandler,

    registrar: (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
        res.status(201).json({ id: await service.registrar(body) });
      } catch (err) {
        responderError(err, res, next);
      }
    }) satisfies RequestHandler,
  };
}

/**
 * Adaptador HTTP de la bandeja (montar con sesión del panel):
 *
 *   GET  /                 → SolicitudDto[] (más antigua primero)
 *   POST /:id/reservar     { inicio, doctorId? } → 201 ReservaResultado
 *
 * `authorize` permite inyectar requireRole(...) sin que el módulo dependa del JS legado.
 */
export function derivacionesRouter(service: DerivacionesService, opts: { authorize?: RequestHandler } = {}): Router {
  const router = Router();
  const h = crearHandlers(service);
  const guard: RequestHandler[] = opts.authorize ? [opts.authorize] : [];
  router.get("/", ...guard, h.listar);
  router.post("/:id/reservar", ...guard, h.reservar);
  return router;
}

/**
 * Alta de derivaciones para el Asistente de WhatsApp (montar con requireApiKey, SIN sesión):
 *
 *   POST /  { telefono, paciente, especialidad, bloque, fecha, doctorId, acudiente?, notas? } → 201 { id }
 */
export function derivacionesIaRouter(service: DerivacionesService): Router {
  const router = Router();
  router.post("/", crearHandlers(service).registrar);
  return router;
}
