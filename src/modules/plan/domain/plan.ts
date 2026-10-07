/**
 * Plan comercial de Astra Health para la clínica: qué módulos premium están activos
 * (por contrato o por prueba gratuita) y cuántos operadores puede tener el panel.
 *
 * El contrato vive en la tabla `plan_clinica`: Soluciones Astra lo cambia con un UPDATE;
 * el código no trae licencias "quemadas".
 */
export const MODULOS = ["reportes", "multi_calendario", "notificaciones_avanzadas", "agendamiento_ia"] as const;
export type Modulo = (typeof MODULOS)[number];

/**
 * Días de prueba gratuita por módulo. Un módulo ausente NO ofrece prueba.
 * agendamiento_ia: 7 días, para que la clínica compare una semana completa
 * (incluido un fin de semana) de citas confirmadas por la IA contra el modo derivación.
 */
export const DIAS_PRUEBA_POR_MODULO: Readonly<Partial<Record<Modulo, number>>> = Object.freeze({
  reportes: 7,
  agendamiento_ia: 7,
});

/** Compatibilidad con clientes que leen `diasPrueba` de GET /api/plan. Usa diasPruebaPorModulo. */
export const DIAS_PRUEBA = 3;
const DIA_MS = 86_400_000;

/** Textos acordados con Soluciones Astra (mismos que frontend/src/components/dashboard/plan/plan.js). */
export const MENSAJE_MODULO: Record<Modulo, string> = {
  reportes:
    "Módulo Premium Activo en Plan Corporativo. Consulte a Soluciones Astra para habilitar la analítica avanzada de ausentismo (Pacientes Inasistentes).",
  multi_calendario: "Función Multi-Calendario Unificado disponible contactando a Soluciones Astra.",
  notificaciones_avanzadas: "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra.",
  // PENDIENTE de visto bueno de Soluciones Astra.
  agendamiento_ia:
    "Agendamiento Automático con IA: el asistente confirma citas por WhatsApp las 24 horas. Consulte a Soluciones Astra para activarlo.",
};

export const MENSAJE_LIMITE_OPERADORES =
  "Límite de operadores alcanzado. Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.";

export interface Contrato {
  maxOperadores: number;
  modulos: readonly string[];
}

export interface Prueba {
  modulo: Modulo;
  iniciadaEn: Date;
  expiraEn: Date;
}

export interface EstadoModulo {
  habilitado: boolean;
  origen: "contrato" | "prueba" | null;
  pruebaExpiraEn: string | null;
  pruebaDisponible: boolean;
}

/** Contrato EXACTO de GET /api/plan. */
export interface EstadoPlan {
  modulos: Record<Modulo, EstadoModulo>;
  operadores: { activos: number; maximo: number };
  /** @deprecated usar diasPruebaPorModulo[modulo]. */
  diasPrueba: number;
  diasPruebaPorModulo: Partial<Record<Modulo, number>>;
}

export type PlanErrorCode = "MODULO_PREMIUM" | "LIMITE_OPERADORES" | "PRUEBA_NO_DISPONIBLE" | "MODULO_INVALIDO";

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  readonly modulo: Modulo | null;
  constructor(code: PlanErrorCode, message: string, modulo: Modulo | null = null) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.modulo = modulo;
  }
}

export function isPlanError(err: unknown): err is PlanError {
  return err instanceof PlanError;
}

export function esModulo(valor: unknown): valor is Modulo {
  return typeof valor === "string" && (MODULOS as readonly string[]).includes(valor);
}

const ofrecePrueba = (modulo: Modulo): boolean => (DIAS_PRUEBA_POR_MODULO[modulo] ?? 0) > 0;

export function calcularEstadoPlan(contrato: Contrato, pruebas: readonly Prueba[], operadoresActivos: number, ahora: Date): EstadoPlan {
  const modulos = {} as Record<Modulo, EstadoModulo>;
  for (const modulo of MODULOS) {
    if (contrato.modulos.includes(modulo)) {
      modulos[modulo] = { habilitado: true, origen: "contrato", pruebaExpiraEn: null, pruebaDisponible: false };
      continue;
    }
    const prueba = pruebas.find((p) => p.modulo === modulo);
    if (prueba && prueba.expiraEn.getTime() > ahora.getTime()) {
      modulos[modulo] = { habilitado: true, origen: "prueba", pruebaExpiraEn: prueba.expiraEn.toISOString(), pruebaDisponible: false };
      continue;
    }
    modulos[modulo] = { habilitado: false, origen: null, pruebaExpiraEn: null, pruebaDisponible: !prueba && ofrecePrueba(modulo) };
  }
  return {
    modulos,
    operadores: { activos: operadoresActivos, maximo: contrato.maxOperadores },
    diasPrueba: DIAS_PRUEBA,
    diasPruebaPorModulo: { ...DIAS_PRUEBA_POR_MODULO },
  };
}

export function verificarCupoOperador(activos: number, maximo: number): void {
  if (activos >= maximo) throw new PlanError("LIMITE_OPERADORES", MENSAJE_LIMITE_OPERADORES);
}

/** Una prueba por módulo y por clínica, para siempre; solo módulos que la ofrecen y no contratados. */
export function crearPrueba(modulo: unknown, contrato: Contrato, pruebas: readonly Prueba[], ahora: Date): Prueba {
  if (!esModulo(modulo)) throw new PlanError("MODULO_INVALIDO", "Módulo desconocido");
  const dias = DIAS_PRUEBA_POR_MODULO[modulo];
  if (!dias || contrato.modulos.includes(modulo) || pruebas.some((p) => p.modulo === modulo)) {
    throw new PlanError("PRUEBA_NO_DISPONIBLE", "La prueba gratuita de este módulo ya se usó o no está disponible.", modulo);
  }
  return { modulo, iniciadaEn: ahora, expiraEn: new Date(ahora.getTime() + dias * DIA_MS) };
}

/** Excepción RAISE 'LIMITE_OPERADORES' del trigger trg_usuarios_limite_operadores. */
export function esErrorLimiteBd(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === "P0001" && typeof e.message === "string" && e.message.includes("LIMITE_OPERADORES");
}