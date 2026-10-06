import { pedir } from "./derivaciones";

/** GET /api/impacto-ia (solo rol dirección). */
export const obtenerImpactoIa = ({ signal } = {}) => pedir("/api/impacto-ia", { signal });