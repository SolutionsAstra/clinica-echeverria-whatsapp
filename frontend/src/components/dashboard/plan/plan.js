/**
 * Plan comercial de Astra Health — lógica pura (sin React), probada con `node --test`.
 *
 * La autoridad es el servidor (GET /api/plan, src/modules/plan). Este módulo solo
 * interpreta su respuesta para pintar candados; el backend vuelve a validar cada acción.
 *
 * Forma de la respuesta:
 *   { modulos: { [modulo]: { habilitado, origen: 'contrato'|'prueba'|null, pruebaExpiraEn, pruebaDisponible } },
 *     operadores: { activos, maximo }, diasPrueba, diasPruebaPorModulo }
 */

export const MODULO = Object.freeze({
  REPORTES: "reportes",
  MULTI_CALENDARIO: "multi_calendario",
  NOTIFICACIONES: "notificaciones_avanzadas",
  AGENDAMIENTO_IA: "agendamiento_ia",
  ANALITICA_FINANCIERA: "analitica_financiera",
  LISTA_ESPERA_VIP: "lista_espera_vip",
  REACTIVACION_DORMIDOS: "reactivacion_dormidos",
});

/** Código con el que el servidor responde un módulo no contratado (src/modules/plan/http/plan.router.ts). */
export const CODIGO_BLOQUEO_PREMIUM = "MODULO_PREMIUM";

/** Textos comerciales acordados con Soluciones Astra: no reescribir sin su visto bueno. */
export const MENSAJES = Object.freeze({
  [MODULO.REPORTES]:
    "Módulo Premium Activo en Plan Corporativo. Consulte a Soluciones Astra para habilitar la analítica avanzada de ausentismo (Pacientes Inasistentes).",
  [MODULO.MULTI_CALENDARIO]: "Función Multi-Calendario Unificado disponible contactando a Soluciones Astra.",
  [MODULO.NOTIFICACIONES]: "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra.",
  [MODULO.AGENDAMIENTO_IA]:
    "Agendamiento Automático con IA: el asistente confirma citas por WhatsApp las 24 horas. Consulte a Soluciones Astra para activarlo.",
  // Mismos textos que MENSAJE_MODULO del servidor (PENDIENTES de visto bueno de Soluciones Astra).
  [MODULO.ANALITICA_FINANCIERA]:
    "Analítica Financiera: ganancias brutas, ingresos por especialista y asistencia vs. cancelaciones en Looker Studio. Consulte a Soluciones Astra para activarla.",
  [MODULO.LISTA_ESPERA_VIP]:
    "Lista de Espera VIP: la IA reserva un lugar a los pacientes cuando la agenda está llena y les avisa por WhatsApp al liberarse un cupo. Consulte a Soluciones Astra para activarla.",
  [MODULO.REACTIVACION_DORMIDOS]:
    "Reactivación de Pacientes Dormidos: campañas automáticas por WhatsApp a pacientes sin citas en 3 o 6 meses. Consulte a Soluciones Astra para activarla.",
      LIMITE_OPERADORES:
    "Límite de operadores alcanzado. Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.",
});

/** Título de la tarjeta de bloqueo de cada módulo. */
export const TITULOS = Object.freeze({
  [MODULO.REPORTES]: "Analítica avanzada de ausentismo",
  [MODULO.MULTI_CALENDARIO]: "Multi-Calendario Unificado",
  [MODULO.NOTIFICACIONES]: "Notificaciones Avanzadas",
  [MODULO.AGENDAMIENTO_IA]: "Agente IA Agenda",
  [MODULO.ANALITICA_FINANCIERA]: "Analítica Financiera",
  [MODULO.LISTA_ESPERA_VIP]: "Lista de Espera VIP",
  [MODULO.REACTIVACION_DORMIDOS]: "Reactivación de Pacientes Dormidos",
});

/** Respaldo si GET /api/plan aún no expone diasPruebaPorModulo (igual a DIAS_PRUEBA_POR_MODULO del servidor). */
const DIAS_PRUEBA_RESPALDO = Object.freeze({
  [MODULO.REPORTES]: 7,
  [MODULO.AGENDAMIENTO_IA]: 7,
  [MODULO.ANALITICA_FINANCIERA]: 7,
  [MODULO.LISTA_ESPERA_VIP]: 7,
  [MODULO.REACTIVACION_DORMIDOS]: 7,
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
 * no un error de carga: la vista debe mostrar el bloqueo, nunca "No se pudo cargar esta sección".
 */
export function esBloqueoPremium(err) {
  return err?.status === 403 && err?.code === CODIGO_BLOQUEO_PREMIUM;
}

/**
 * Días de prueba del módulo según el servidor (7 agendamiento_ia, 3 reportes).
 * 0 = el módulo no ofrece prueba: el bloqueo solo invita a contactar a Soluciones Astra.
 */
export function diasPruebaDe(plan, modulo) {
  const porModulo = plan?.diasPruebaPorModulo;
  if (porModulo && typeof porModulo === "object") return Number(porModulo[modulo]) || 0;
  return DIAS_PRUEBA_RESPALDO[modulo] ?? plan?.diasPrueba ?? 0;
}

export function etiquetaPrueba(dias) {
  if (!dias || dias <= 0) return "Probar Gratis";
  return `Probar Gratis por ${dias} ${dias === 1 ? "día" : "días"}`;
}