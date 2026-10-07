export type CancelacionErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CITA_NO_ACTIVA"
  | "MODULO_PREMIUM"
  | "LIMITE_REAGENDAMIENTO"
  | "REAGENDAMIENTO_NO_PERMITIDO";

export class CancelacionError extends Error {
  constructor(
    readonly code: CancelacionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CancelacionError";
  }
}

export function isCancelacionError(err: unknown): err is CancelacionError {
  return err instanceof CancelacionError;
}