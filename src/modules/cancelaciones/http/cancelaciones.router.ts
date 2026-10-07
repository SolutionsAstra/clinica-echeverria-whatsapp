import { Router, type NextFunction, type Request, type Response } from "express";
import { isVetError, type VetErrorCode } from "../../vet";
import { isCancelacionError, type CancelacionErrorCode } from "../domain/errors";
import type { CancelacionesService } from "../application/cancelaciones-service";

const STATUS: Record<VetErrorCode | CancelacionErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  MODULO_PREMIUM: 403,
  CITA_NO_ACTIVA: 409,
  LIMITE_REAGENDAMIENTO: 409,
  REAGENDAMIENTO_NO_PERMITIDO: 409,
  SLOT_TAKEN: 409,
  SLOT_NOT_OFFERED: 422,
  RESOURCE_NOT_CONFIGURED: 422,
  INVALID_DURATION: 422,
  DURATION_MISMATCH: 422,
  BUSY_RETRY: 503,
};

/**
 * Asistente de WhatsApp (montar con x-api-key, SIN sesión):
 *   POST /cancelar   { telefono, citaId, intencion }  → 200 ResultadoCancelacion
 *   POST /reagendar  { telefono, citaAnteriorId, especialidad, doctorId, inicio, notas? } → 201
 */
export function cancelacionesIaRouter(service: CancelacionesService): Router {
  const router = Router();

  const responderError = (err: unknown, res: Response, next: NextFunction): void => {
    if (isCancelacionError(err) || isVetError(err)) {
      res.status(STATUS[err.code]).json({ error: err.code, mensaje: err.message });
      return;
    }
    next(err);
  };

  router.post("/cancelar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.cancelar(req.body));
    } catch (err) {
      responderError(err, res, next);
    }
  });

  router.post("/reagendar", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await service.reagendar(req.body));
    } catch (err) {
      responderError(err, res, next);
    }
  });

  return router;
}