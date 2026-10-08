// routes/citaManual.routes.ts
// Alta manual de citas desde el calendario del panel (recepción y dirección).
//   POST /api/citas/manual
//     { nombre, telefono, especialidad, doctorId, inicio, nombreAcudiente?, notas? }
//     Formulario tipo Google Calendar: también acepta fecha + hora (hora de Caracas)
//     y los alias paciente / nombrePaciente / doctor_id / acudiente / descripcion.
//   → 201 { appointmentId, doctorId, doctorName, start, end, origen: "panel", whatsapp: "en_cola" }
//   → 400 INVALID_INPUT
//   → 409 SLOT_TAKEN
//   → 422 HORARIO_NO_PERMITIDO { error, message }   ← madrugada / noche / día libre / fuera del turno
//   → 422 DOCTOR_NO_HABILITADO · SLOT_NOT_OFFERED · HORARIO_DOCTOR_MAL_CONFIGURADO · RESOURCE_NOT_CONFIGURED …
//   → 503 BUSY_RETRY | MIGRACION_PENDIENTE | BD_NO_DISPONIBLE
//   → 500 ERROR_AGENDA (solo fallas no clasificadas, con referencia de log)
// Esta ruta NUNCA delega en el manejador central de server.js.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  DEFAULT_VET_CONFIG,
  isSpecialty,
  isVetError,
  SPECIALTY_RULES,
  type Specialty,
  type VetErrorCode,
} from "../modules/vet";
import { mensajeConfirmacion } from "../modules/derivaciones/domain/derivacion";
import type { Booker, Notifier } from "../modules/derivaciones/application/ports";

const TZ_CLINICA = "America/Caracas";
const OFFSET_CLINICA = "-04:00"; // Venezuela: UTC-4 todo el año, sin horario de verano
const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const MAX_NOTAS = 400;
const MINUTOS_DIA = 24 * 60;

type Cuerpo = Record<string, unknown>;

export interface Rechazo {
  status: number;
  error: string;
  mensaje: string;
}

interface Logger {
  error: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

/** ¿Hay una cita activa que choque con [inicio, fin) para ese doctor o el recurso de la especialidad? */
export type HorarioOcupado = (q: { doctorId: number; especialidad: Specialty; inicio: Date; fin: Date }) => Promise<boolean>;

/** Fila de horarios_disponibilidad tal como llega de Supabase (formato sin normalizar). */
export interface TurnoCrudo {
  dias: unknown; // '1,2,3' | [1,2,3] | '{1,2,3}'
  horaInicio: unknown; // '08:00' | '08:00:00'
  horaFin: unknown;
}

/**
 * Turnos del doctor PARA esa especialidad.
 * null = el doctor no existe, está inactivo o no tiene habilitada la especialidad.
 * []   = habilitado pero sin horario cargado.
 */
export type LectorHorarioDoctor = (q: { doctorId: number; especialidad: Specialty }) => Promise<TurnoCrudo[] | null>;

// =====================================================================================
// Fecha y hora en el huso de Caracas (puras, sin depender del huso del servidor)
// =====================================================================================

const NUM_DIA: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

const FORMATO_CARACAS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ_CLINICA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Fecha local (YYYY-MM-DD), día de la semana (0 = domingo) y minutos desde medianoche, en Caracas. */
export function partesCaracas(instante: Date): { fecha: string; diaSemana: number; minutos: number } {
  const p = Object.fromEntries(FORMATO_CARACAS.formatToParts(instante).map((x) => [x.type, x.value]));
  const hora = Number(p.hour) % 24; // algunos runtimes devuelven "24" a medianoche
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    diaSemana: NUM_DIA[p.weekday],
    minutos: hora * 60 + Number(p.minute),
  };
}

/** 'HH:MM' o 'HH:MM:SS' (columna TIME de Postgres) → minutos. '24:00' vale como fin de día. null si es inválida. */
export function parseHora(valor: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return MINUTOS_DIA;
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** '1,2,3' | [1,2,3] | '{1,2,3}' → [1,2,3] (0 = domingo … 6 = sábado). null si no hay días válidos. */
export function parseDias(valor: unknown): number[] | null {
  const lista: unknown[] | null = Array.isArray(valor)
    ? valor
    : typeof valor === "string"
      ? valor.replace(/[{}\s]/g, "").split(",")
      : typeof valor === "number"
        ? [valor]
        : null;
  if (!lista) return null;
  const dias = lista.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return dias.length ? [...new Set(dias)] : null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type MotivoHorario = "CRUZA_MEDIANOCHE" | "FUERA_DEL_CENTRO" | "SIN_HORARIO" | "DIA_LIBRE" | "FUERA_DE_TURNO";

export type EvaluacionHorario =
  | { permitido: true; descartados: number }
  | { permitido: false; motivo: MotivoHorario; detalle: string; descartados: number };

/**
 * ¿El bloque [inicio, inicio + duración) cae dentro de la atención del doctor ese día, en Caracas?
 *  1. No puede cruzar la medianoche.
 *  2. Debe estar dentro del horario del centro (DEFAULT_VET_CONFIG.clinicHours, 08:00–17:00):
 *     madrugada y noche se rechazan aquí.
 *  3. El doctor debe tener algún turno ese día de la semana (día libre → rechazo).
 *  4. El bloque completo debe caber en un turno ∩ horario del centro.
 * Filas corruptas se descartan (se informa la cantidad) en lugar de lanzar.
 */
export function evaluarHorario(e: {
  inicio: Date;
  duracionMin: number;
  turnos: readonly TurnoCrudo[];
  centro?: { openMinute: number; closeMinute: number };
}): EvaluacionHorario {
  const centro = e.centro ?? DEFAULT_VET_CONFIG.clinicHours;
  const { fecha, diaSemana, minutos: ini } = partesCaracas(e.inicio);
  const fin = ini + e.duracionMin;
  const detalle = `${NOMBRE_DIA[diaSemana]} ${fecha} ${hhmm(ini)}–${hhmm(fin % MINUTOS_DIA)} (Caracas)`;

  const validos: { dias: number[]; open: number; close: number }[] = [];
  let descartados = 0;
  for (const t of e.turnos) {
    const dias = parseDias(t.dias);
    const open = parseHora(t.horaInicio);
    const close = parseHora(t.horaFin);
    if (!dias || open === null || close === null || open >= close) descartados++;
    else validos.push({ dias, open, close });
  }

  const rechazo = (motivo: MotivoHorario): EvaluacionHorario => ({ permitido: false, motivo, detalle, descartados });

  if (fin > MINUTOS_DIA) return rechazo("CRUZA_MEDIANOCHE");
  if (ini < centro.openMinute || fin > centro.closeMinute) return rechazo("FUERA_DEL_CENTRO");
  if (!validos.length) return rechazo("SIN_HORARIO");

  const delDia = validos.filter((t) => t.dias.includes(diaSemana));
  if (!delDia.length) return rechazo("DIA_LIBRE");

  const cabe = delDia.some(
    (t) => ini >= Math.max(t.open, centro.openMinute) && fin <= Math.min(t.close, centro.closeMinute),
  );
  return cabe ? { permitido: true, descartados } : rechazo("FUERA_DE_TURNO");
}

// =====================================================================================
// Lectura del formulario
// =====================================================================================

export function normalizarTelefono(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = `58${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith("4")) d = `58${d}`;
  return /^\d{11,15}$/.test(d) ? d : null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

function primero(b: Cuerpo, claves: readonly string[]): unknown {
  for (const k of claves) {
    const v = b[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Inicio de la cita como ISO 8601 con offset explícito (lo exige vet.book).
 * Acepta `inicio`/`start` ya con offset, o `fecha` (YYYY-MM-DD) + `hora` (HH:MM) en hora de Caracas.
 * Rechaza segundos o milisegundos distintos de cero: la rejilla del motor es por minuto.
 */
export function leerInicio(b: Cuerpo): string | null {
  const crudo = primero(b, ["inicio", "start", "fechaHoraInicio"]);
  let iso: string | null = null;
  if (typeof crudo === "string" && ISO_CON_OFFSET.test(crudo.trim())) {
    iso = crudo.trim();
  } else if (
    crudo === undefined &&
    typeof b.fecha === "string" && FECHA.test(b.fecha) &&
    typeof b.hora === "string" && HORA.test(b.hora)
  ) {
    iso = `${b.fecha}T${b.hora}:00${OFFSET_CLINICA}`;
  }
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms % 60_000 === 0 ? iso : null;
}

// =====================================================================================
// Traducción de rechazos (nunca 500 genérico)
// =====================================================================================

const HORARIO_NO_PERMITIDO = Object.freeze({
  error: "HORARIO_NO_PERMITIDO",
  message: "El doctor no atiende en el horario o día seleccionado",
});

const CODIGOS_DE_CONFIGURACION = new Set<VetErrorCode>(["RESOURCE_NOT_CONFIGURED", "INVALID_DURATION", "DURATION_MISMATCH"]);

const RECHAZO_VET: Record<VetErrorCode, { status: number; mensaje: string | null }> = {
  INVALID_INPUT: { status: 400, mensaje: null }, // se conserva el mensaje del motor (indica el campo)
  SLOT_TAKEN: { status: 409, mensaje: "Ese horario ya está ocupado por otra cita. Elige otra hora." },
  SLOT_NOT_OFFERED: {
    status: 422,
    mensaje:
      "La hora elegida no es reservable: debe estar dentro de la ventana de 3 días y alineada a la duración " +
      "de la especialidad (Neurología 60 min, EEG 120 min, Pediatría 30 min, Estética 45 min).",
  },
  BUSY_RETRY: { status: 503, mensaje: "La agenda se está actualizando. Intenta de nuevo en unos segundos." },
  RESOURCE_NOT_CONFIGURED: {
    status: 422,
    mensaje: "Esta especialidad requiere un consultorio o equipo que no está configurado en la agenda. Avisa a soporte.",
  },
  INVALID_DURATION: { status: 422, mensaje: "La duración configurada para esta especialidad no es válida. Avisa a soporte." },
  DURATION_MISMATCH: { status: 422, mensaje: "La duración de la especialidad no coincide con la regla del centro. Avisa a soporte." },
};

const BD_NO_DISPONIBLE: Rechazo = {
  status: 503,
  error: "BD_NO_DISPONIBLE",
  mensaje: "No hay conexión con la base de datos. Intenta de nuevo en unos segundos.",
};
const MIGRACION_PENDIENTE: Rechazo = {
  status: 503,
  error: "MIGRACION_PENDIENTE",
  mensaje: "La base de datos no tiene aplicada una migración requerida por la agenda. Avisa a soporte.",
};
const SLOT_OCUPADO: Rechazo = { status: 409, error: "SLOT_TAKEN", mensaje: RECHAZO_VET.SLOT_TAKEN.mensaje as string };
const HORARIO_MAL_CONFIGURADO: Rechazo = {
  status: 422,
  error: "HORARIO_DOCTOR_MAL_CONFIGURADO",
  mensaje: "El horario del doctor tiene un formato inválido en la base de datos. Revísalo en la sección Doctores o avisa a soporte.",
};

const RECHAZO_PG = new Map<string, Rechazo>([
  ["23503", { status: 422, error: "REFERENCIA_INVALIDA", mensaje: "El doctor o la especialidad seleccionados no existen o están inactivos." }],
  ["23514", { status: 422, error: "DATOS_RECHAZADOS", mensaje: "La base de datos rechazó la cita por una regla de integridad (horario u origen)." }],
  ["23505", SLOT_OCUPADO],
  ["22007", HORARIO_MAL_CONFIGURADO], // formato de fecha/hora inválido
  ["22008", HORARIO_MAL_CONFIGURADO], // fecha/hora fuera de rango
  ["42703", MIGRACION_PENDIENTE], // columna inexistente (p. ej. citas.origen)
  ["42P01", MIGRACION_PENDIENTE], // tabla inexistente
  ["55P03", { status: 503, error: "BUSY_RETRY", mensaje: RECHAZO_VET.BUSY_RETRY.mensaje as string }],
  ["57P01", BD_NO_DISPONIBLE],
  ["08000", BD_NO_DISPONIBLE],
  ["08003", BD_NO_DISPONIBLE],
  ["08006", BD_NO_DISPONIBLE],
]);
const RED_CAIDA = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Errores NO tipados que lanza el motor al leer horarios corruptos:
 *   parseHHMM → "Hora inválida: …" / "Hora fuera de rango: …"
 *   toShift   → TypeError "dias.split is not a function" (columna INT[] en vez de CSV)
 */
const ERROR_DATOS_HORARIO = /^(Hora inválida|Hora fuera de rango)|\bsplit is not a function\b/;

/** Traduce cualquier rechazo conocido del motor VET o de Postgres. null = falla realmente inesperada. */
export function clasificarError(err: unknown): Rechazo | null {
  if (isVetError(err)) {
    const r = RECHAZO_VET[err.code];
    return { status: r.status, error: err.code, mensaje: r.mensaje ?? err.message };
  }
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string") {
    const pg = RECHAZO_PG.get(code);
    if (pg) return pg;
    if (RED_CAIDA.has(code)) return BD_NO_DISPONIBLE;
  }
  if (err instanceof Error) {
    if (ERROR_DATOS_HORARIO.test(err.message)) return HORARIO_MAL_CONFIGURADO;
    if (/no existe en la tabla especialidades/i.test(err.message)) {
      return { status: 422, error: "ESPECIALIDAD_NO_CONFIGURADA", mensaje: "La especialidad no está dada de alta en la base de datos. Avisa a soporte." };
    }
  }
  return null;
}

// =====================================================================================
// Router
// =====================================================================================

export function citaManualRouter({
  scheduler,
  notifier,
  horarioDoctor,
  horarioOcupado,
  logger = console,
}: {
  scheduler: Booker;
  notifier: Notifier;
  /** Obligatorio: reglas de atención del doctor leídas de Supabase antes de reservar. */
  horarioDoctor: LectorHorarioDoctor;
  /** Opcional: distingue "ocupado" (409) de "fuera de agenda" (422) cuando el motor responde SLOT_NOT_OFFERED. */
  horarioOcupado?: HorarioOcupado;
  logger?: Logger;
}): Router {
  if (typeof horarioDoctor !== "function") {
    // Falla al ARRANCAR, no en la primera cita de la recepcionista.
    throw new Error("[cita-manual] falta la dependencia horarioDoctor (lector de horarios del doctor)");
  }
  const router = Router();

  function responderFallaInesperada(res: Response, err: unknown): void {
    const ref = randomUUID().slice(0, 8);
    logger.error(`[cita-manual] Falla no clasificada ref=${ref}:`, err);
    if (res.headersSent) return;
    res.status(500).json({
      error: "ERROR_AGENDA",
      mensaje: `No se pudo registrar la cita. Comparte esta referencia con soporte: ${ref}.`,
      ref,
    });
  }

  async function crearCita(req: Request, res: Response): Promise<void> {
    const b: Cuerpo = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Cuerpo) : {};

    const nombre = texto(primero(b, ["nombre", "paciente", "nombrePaciente"]));
    const telefono = normalizarTelefono(primero(b, ["telefono", "celular"]));
    const especialidad = primero(b, ["especialidad", "especialidadCodigo"]);
    const doctorId = Number(primero(b, ["doctorId", "doctor_id"]));
    const inicio = leerInicio(b);
    const nombreAcudiente = texto(primero(b, ["nombreAcudiente", "acudiente"])) || null;
    const notas = texto(primero(b, ["notas", "descripcion"])).slice(0, MAX_NOTAS) || null;

    // ---------- 1. Forma del formulario (400) ----------
    const campos: string[] = [];
    if (nombre.length < 3 || nombre.length > 150) campos.push("nombre");
    if (!telefono) campos.push("telefono");
    if (!isSpecialty(especialidad)) campos.push("especialidad");
    if (!Number.isInteger(doctorId) || doctorId <= 0) campos.push("doctorId");
    if (!inicio || Date.parse(inicio) <= Date.now()) campos.push("inicio");
    if (campos.length || !telefono || !inicio || !isSpecialty(especialidad)) {
      res.status(400).json({ error: "INVALID_INPUT", mensaje: "Revisa los datos de la cita.", campos });
      return;
    }

    const inicioDate = new Date(inicio);
    const duracionMin = SPECIALTY_RULES[especialidad].durationMin;

    try {
      // ---------- 2. Validación horaria estricta ANTES del motor (422) ----------
      const turnos = await horarioDoctor({ doctorId, especialidad });
      if (turnos === null) {
        res.status(422).json({
          error: "DOCTOR_NO_HABILITADO",
          mensaje: "El doctor seleccionado no está activo o no atiende esta especialidad.",
        });
        return;
      }
      const evaluacion = evaluarHorario({ inicio: inicioDate, duracionMin, turnos });
      if (evaluacion.descartados > 0) {
        logger.error(`[cita-manual] doctor ${doctorId}: ${evaluacion.descartados} fila(s) de horario con formato inválido`);
      }
      if (!evaluacion.permitido) {
        logger.warn?.(`[cita-manual] HORARIO_NO_PERMITIDO doctor=${doctorId} ${evaluacion.motivo} · ${evaluacion.detalle}`);
        res.status(422).json(HORARIO_NO_PERMITIDO);
        return;
      }

      // ---------- 3. Motor de reservas (fuente de verdad: ventana VET, rejilla, choques) ----------
      const booking = await scheduler.book({
        specialty: especialidad,
        doctorId,
        start: inicio,
        patient: { telefono, nombre, esMenor: Boolean(nombreAcudiente), nombreAcudiente },
        notes: notas,
        // Explícito: la puerta del panel SIEMPRE registra origen = 'panel' (lista blanca en vet-scheduler).
        origin: "panel",
      });

      // Notificación en caliente sin bloquear la respuesta (mismo patrón que derivaciones).
      const confirmacion = mensajeConfirmacion({ pacienteNombre: nombre, nombreAcudiente, especialidad }, booking);
      setImmediate(() => {
        Promise.resolve()
          .then(() => notifier.enviarTexto(telefono, confirmacion))
          .catch((err: unknown) => logger.error("[cita-manual] WhatsApp falló:", err));
      });

      res.status(201).json({
        appointmentId: booking.appointmentId,
        doctorId: booking.doctorId,
        doctorName: booking.doctorName,
        start: booking.start,
        end: booking.end,
        origen: "panel",
        whatsapp: "en_cola",
      });
    } catch (err) {
      // ---------- 4. Captura segura: todo rechazo conocido sale como 4xx/503 ----------
      let rechazo = clasificarError(err);

      // SLOT_NOT_OFFERED puede significar "ocupado" (409) o "fuera de ventana/rejilla" (422).
      if (rechazo?.error === "SLOT_NOT_OFFERED" && horarioOcupado) {
        try {
          const fin = new Date(inicioDate.getTime() + duracionMin * 60_000);
          if (await horarioOcupado({ doctorId, especialidad, inicio: inicioDate, fin })) rechazo = SLOT_OCUPADO;
        } catch (e) {
          logger.error("[cita-manual] No se pudo verificar el choque de horario:", e);
        }
      }

      if (!rechazo) {
        responderFallaInesperada(res, err);
        return;
      }
      if (
        rechazo.status >= 500 ||
        rechazo === HORARIO_MAL_CONFIGURADO ||
        (isVetError(err) && CODIGOS_DE_CONFIGURACION.has(err.code))
      ) {
        logger.error(`[cita-manual] ${rechazo.error}:`, err);
      }
      if (!res.headersSent) res.status(rechazo.status).json({ error: rechazo.error, mensaje: rechazo.mensaje });
    }
  }

  // Red de seguridad final: ni siquiera un throw fuera del try llega a next(err).
  router.post("/", (req: Request, res: Response) => {
    crearCita(req, res).catch((err: unknown) => responderFallaInesperada(res, err));
  });

  return router;
}