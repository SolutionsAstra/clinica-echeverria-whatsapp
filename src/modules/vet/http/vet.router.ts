import { Router, type Request, type Response, type NextFunction } from "express";
import { isSpecialty, SPECIALTIES, type VetScheduler } from "..";

/**
 * Adaptador HTTP: solo traduce request ↔ VetScheduler. Sin lógica de negocio.
 * GET /disponibilidad?especialidad=neurologia
 */
export function vetRouter(scheduler: VetScheduler): Router {
  const router = Router();

  router.get("/disponibilidad", async (req: Request, res: Response, next: NextFunction) => {
    const especialidad = req.query.especialidad;
    if (!isSpecialty(especialidad)) {
      res.status(400).json({ error: "especialidad_invalida", permitidas: SPECIALTIES });
      return;
    }
    try {
      res.json(await scheduler.getAvailability(especialidad));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
