import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Autenticación servicio-a-servicio para el Asistente de WhatsApp:
 * header `x-api-key` comparado en tiempo constante.
 */
export function requireApiKey(expected: string | undefined) {
  if (!expected || expected.length < 24) {
    throw new Error("VET_API_KEY no configurada o demasiado corta (mínimo 24 caracteres)");
  }
  const expectedHash = sha256(expected);
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header("x-api-key");
    if (!provided || !timingSafeEqual(sha256(provided), expectedHash)) {
      res.status(401).json({ error: "api_key_invalida" });
      return;
    }
    next();
  };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
