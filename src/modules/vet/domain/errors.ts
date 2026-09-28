export type VetErrorCode =
  | "INVALID_INPUT"
  | "SLOT_NOT_OFFERED"
  | "SLOT_TAKEN"
  | "BUSY_RETRY"
  | "RESOURCE_NOT_CONFIGURED"
  | "INVALID_DURATION"
  | "DURATION_MISMATCH";

/** Error de negocio del módulo VET. La capa HTTP lo traduce a un status. */
export class VetError extends Error {
  constructor(
    readonly code: VetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VetError";
  }
}

export function isVetError(err: unknown): err is VetError {
  return err instanceof VetError;
}
