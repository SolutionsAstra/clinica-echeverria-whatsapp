import { Router, type NextFunction, type Request, type Response } from "express";
import type { VetScheduler } from "../application/vet-scheduler";
import type { PatientInput } from "../application/ports";
import { parseSpecialty, SPECIALTIES } from "../domain/specialty";
import { isVetError, type VetErrorCode } from "../domain/errors";

const STATUS: Record<VetErrorCode, number> = {
  INVALID_INPUT: 400,
  SLOT_NOT_OFFERED: 422,
  SLOT_TAKEN: 409,
  BUSY_RETRY: 503,
  RESOURCE_NOT_CONFIGURED: 500,
};

/**
 * Adaptador HTTP del módulo VET: solo traduce request ↔ VetScheduler.
 *
 *   GET  /disponibilidad?especialidad=neurologia
 *   POST /citas  { especialidad, doctorId, inicio, paciente: { telefono, nombre, ... }, notas? }
 */
export function vetRouter(scheduler: VetScheduler): Router {
  const router = Router();

  router.get("/disponibilidad", async (req: Request, res: Response, next: NextFunction) => {
    const specialty = parseSpecialty(req.query.especialidad);
    if (!specialty) {
      res.status(400).json({ error: "especialidad_invalida", permitidas: SPECIALTIES });
      return;
    }
    try {
      res.json(await scheduler.getAvailability(specialty));
    } catch (err) {
      handle(err, res, next);
    }
  });

  router.post("/citas", async (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const specialty = parseSpecialty(body.especialidad);
    if (!specialty) {
      res.status(400).json({ error: "especialidad_invalida", permitidas: SPECIALTIES });
      return;
    }
    try {
      const booking = await scheduler.book({
        specialty,
        doctorId: Number(body.doctorId),
        start: String(body.inicio ?? ""),
        patient: (body.paciente ?? {}) as PatientInput,
        notes: typeof body.notas === "string" ? body.notas : null,
      });
      res.status(201).json(booking);
    } catch (err) {
      handle(err, res, next);
    }
  });

  return router;
}

function handle(err: unknown, res: Response, next: NextFunction): void {
  if (isVetError(err)) {
    res.status(STATUS[err.code]).json({ error: err.code, mensaje: err.message });
    return;
  }
  next(err);
}
