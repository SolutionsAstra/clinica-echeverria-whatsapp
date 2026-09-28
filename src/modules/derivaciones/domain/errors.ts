export type DerivacionErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "DERIVACION_NO_DISPONIBLE";

/** Error de negocio de la bandeja. La capa HTTP lo traduce a un status. */
export class DerivacionError extends Error {
  constructor(
    readonly code: DerivacionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DerivacionError";
  }
}

export function isDerivacionError(err: unknown): err is DerivacionError {
  return err instanceof DerivacionError;
}
