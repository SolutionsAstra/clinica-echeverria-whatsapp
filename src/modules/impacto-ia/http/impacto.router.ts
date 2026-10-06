import { Router, type NextFunction, type Request, type Response } from "express";
import type { ImpactoIaService } from "../application/impacto-service";

/** GET / → ImpactoIaDto. Solo conteos agregados: no expone datos de pacientes. */
export function impactoIaRouter(service: ImpactoIaService): Router {
  const router = Router();
  router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await service.resumen());
    } catch (err) {
      next(err);
    }
  });
  return router;
}