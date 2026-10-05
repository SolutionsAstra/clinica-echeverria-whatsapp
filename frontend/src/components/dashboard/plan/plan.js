/**
 * Plan comercial de Astra Health — lógica pura (sin React), probada con `node --test`.
 *
 * La autoridad es el servidor (GET /api/plan, src/modules/plan). Este módulo solo
 * interpreta su respuesta para pintar candados; el backend vuelve a validar cada acción.
 *
 * Forma de la respuesta:
 *   { modulos: { [modulo]: { habilitado, origen: 'contrato'|'prueba'|null, pruebaExpiraEn, pruebaDisponible } },
 *     operadores: { activos, maximo }, diasPrueba }
 */

export const MODULO = Object.freeze({
  REPORTES: "reportes",
  MULTI_CALENDARIO: "multi_calendario",
  NOTIFICACIONES: "notificaciones_avanzadas",
});

/** Textos comerciales acordados con Soluciones Astra: no reescribir sin su visto bueno. */
export const MENSAJES = Object.freeze({
    [MODULO.REPORTES]:
    "Módulo Premium Activo en Plan Corporativo. Consulte a Soluciones Astra para habilitar la analítica avanzada de ausentismo (Pacientes Inasistentes).",
  [MODULO.MULTI_CALENDARIO]: "Función Multi-Calendario Unificado disponible contactando a Soluciones Astra.",
  [MODULO.NOTIFICACIONES]: "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra.",
  LIMITE_OPERADORES:
    "Límite de operadores alcanzado. Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.",
});

const DIA_MS = 86_400_000;

/**
 * @returns {{ conocido: boolean, habilitado: boolean, enPrueba: boolean, pruebaDisponible: boolean, diasRestantes: number|null }}
 */
export function estadoModulo(plan, modulo, ahoraMs) {
  const m = plan?.modulos?.[modulo];
  if (!m) return { conocido: false, habilitado: false, enPrueba: false, pruebaDisponible: false, diasRestantes: null };

  if (m.origen === "prueba") {
    const expira = Date.parse(m.pruebaExpiraEn);
    const vigente = m.habilitado && Number.isFinite(expira) && expira > ahoraMs;
    return {
      conocido: true,
      habilitado: vigente,
      enPrueba: vigente,
      // Una prueba usada no se repite aunque haya vencido entre dos lecturas del plan.
      pruebaDisponible: false,
      diasRestantes: vigente ? Math.ceil((expira - ahoraMs) / DIA_MS) : null,
    };
  }

  return {
    conocido: true,
    habilitado: Boolean(m.habilitado),
    enPrueba: false,
    pruebaDisponible: !m.habilitado && Boolean(m.pruebaDisponible),
    diasRestantes: null,
  };
}

/** @returns {{ conocido: boolean, activos: number, maximo: number, lleno: boolean, excedente: number }} */
export function cupoOperadores(plan) {
  const o = plan?.operadores;
  if (!o) return { conocido: false, activos: 0, maximo: 0, lleno: false, excedente: 0 };
  return {
    conocido: true,
    activos: o.activos,
    maximo: o.maximo,
    lleno: o.activos >= o.maximo,
    excedente: Math.max(0, o.activos - o.maximo),
  };
}
/**
 * El servidor respondió "módulo no contratado" (403 MODULO_PREMIUM). Es un estado comercial,
 * no un error de carga: la vista debe mostrar el bloqueo, no "No se pudo cargar esta sección".
 */
export function esBloqueoPremium(err) {
  return err?.status === 403 && err?.code === "MODULO_PREMIUM";
}