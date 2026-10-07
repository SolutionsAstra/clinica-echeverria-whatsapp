// routes/citaManual.routes.ts
// Alta manual de citas desde el calendario del panel (recepción y dirección).
//   POST /api/citas/manual
//     { nombre, telefono, especialidad, doctorId, inicio, nombreAcudiente?, notas? }
//     Formulario tipo Google Calendar: también acepta fecha + hora (hora de Caracas)
//     y los alias paciente / nombrePaciente / doctor_id / acudiente / descripcion.
//   → 201 { appointmentId, doctorId, doctorName, start, end, origen: "panel", whatsapp: "en_cola" }
//   → 400 INVALID_INPUT · 409 SLOT_TAKEN · 422 SLOT_NOT_OFFERED | RESOURCE_NOT_CONFIGURED | REFERENCIA_INVALIDA …
//   → 503 BUSY_RETRY | MIGRACION_PENDIENTE | BD_NO_DISPONIBLE · 500 ERROR_AGENDA (con referencia de log)
// Esta ruta NUNCA delega en el manejador central de server.js: toda falla sale como { error, mensaje }.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { isSpecialty, isVetError, SPECIALTY_RULES, type Specialty, type VetErrorCode } from "../modules/vet";
import { mensajeConfirmacion } from "../modules/derivaciones/domain/derivacion";
import type { Booker, Notifier } from "../modules/derivaciones/application/ports";

const OFFSET_CLINICA = "-04:00"; // America/Caracas, sin horario de verano
const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const MAX_NOTAS = 400;

type Cuerpo = Record<string, unknown>;

export interface Rechazo {
  status: number;
  error: string;
  mensaje: string;
}

/** ¿Hay una cita activa que choque con [inicio, fin) para ese doctor o el recurso de la especialidad? */
export type HorarioOcupado = (q: { doctorId: number; especialidad: Specialty; inicio: Date; fin: Date }) => Promise<boolean>;

interface Logger {
  error: (...args: unknown[]) => void;
}

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

// ---------------- Traducción de rechazos (nunca 500 genérico) ----------------

/** Errores de configuración: además de responder, se registran para que soporte los vea. */
const CODIGOS_DE_CONFIGURACION = new Set<VetErrorCode>(["RESOURCE_NOT_CONFIGURED", "INVALID_DURATION", "DURATION_MISMATCH"]);

const RECHAZO_VET: Record<VetErrorCode, { status: number; mensaje: string | null }> = {
  INVALID_INPUT: { status: 400, mensaje: null }, // se conserva el mensaje del motor (indica el campo)
  SLOT_TAKEN: { status: 409, mensaje: "Ese horario ya está ocupado por otra cita. Elige otra hora." },
  SLOT_NOT_OFFERED: {
    status: 422,
    mensaje:
      "La hora elegida no es reservable: debe estar dentro de la ventana de 3 días, dentro del turno del doctor " +
      "y alineada a la duración de la especialidad (Neurología 60 min, EEG 120 min, Pediatría 30 min, Estética 45 min).",
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

const RECHAZO_PG = new Map<string, Rechazo>([
  ["23503", { status: 422, error: "REFERENCIA_INVALIDA", mensaje: "El doctor o la especialidad seleccionados no existen o están inactivos." }],
  ["23514", { status: 422, error: "DATOS_RECHAZADOS", mensaje: "La base de datos rechazó la cita por una regla de integridad (horario u origen)." }],
  ["23505", SLOT_OCUPADO],
  ["42703", MIGRACION_PENDIENTE], // columna inexistente (p. ej. citas.origen)
  ["42P01", MIGRACION_PENDIENTE], // tabla inexistente
  ["55P03", { status: 503, error: "BUSY_RETRY", mensaje: RECHAZO_VET.BUSY_RETRY.mensaje as string }],
  ["57P01", BD_NO_DISPONIBLE],
  ["08000", BD_NO_DISPONIBLE],
  ["08003", BD_NO_DISPONIBLE],
  ["08006", BD_NO_DISPONIBLE],
]);
const RED_CAIDA = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

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
  if (err instanceof Error && /no existe en la tabla especialidades/i.test(err.message)) {
    return { status: 422, error: "ESPECIALIDAD_NO_CONFIGURADA", mensaje: "La especialidad no está dada de alta en la base de datos. Avisa a soporte." };
  }
  return null;
}

// ---------------- Router ----------------

export function citaManualRouter({
  scheduler,
  notifier,
  horarioOcupado,
  logger = console,
}: {
  scheduler: Booker;
  notifier: Notifier;
  /** Opcional: distingue "ocupado" (409) de "fuera de agenda" (422) cuando el motor responde SLOT_NOT_OFFERED. */
  horarioOcupado?: HorarioOcupado;
  logger?: Logger;
}): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const b: Cuerpo = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Cuerpo) : {};

    const nombre = texto(primero(b, ["nombre", "paciente", "nombrePaciente"]));
    const telefono = normalizarTelefono(primero(b, ["telefono", "celular"]));
    const especialidad = primero(b, ["especialidad", "especialidadCodigo"]);
    const doctorId = Number(primero(b, ["doctorId", "doctor_id"]));
    const inicio = leerInicio(b);
    const nombreAcudiente = texto(primero(b, ["nombreAcudiente", "acudiente"])) || null;
    const notas = texto(primero(b, ["notas", "descripcion"])).slice(0, MAX_NOTAS) || null;

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

    try {
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
      let rechazo = clasificarError(err);

      // SLOT_NOT_OFFERED puede significar "ocupado" o "fuera de agenda": se confirma contra `citas`.
      if (rechazo?.error === "SLOT_NOT_OFFERED" && horarioOcupado) {
        try {
          const ini = new Date(inicio);
          const fin = new Date(ini.getTime() + SPECIALTY_RULES[especialidad].durationMin * 60_000);
          if (await horarioOcupado({ doctorId, especialidad, inicio: ini, fin })) rechazo = SLOT_OCUPADO;
        } catch (e) {
          logger.error("[cita-manual] No se pudo verificar el choque de horario:", e);
        }
      }

      if (rechazo) {
        if (rechazo.status >= 500 || (isVetError(err) && CODIGOS_DE_CONFIGURACION.has(err.code))) {
          logger.error(`[cita-manual] ${rechazo.error}:`, err);
        }
        res.status(rechazo.status).json({ error: rechazo.error, mensaje: rechazo.mensaje });
        return;
      }

      // Falla no clasificada: respuesta estructurada con referencia para cruzar con el log.
      const ref = randomUUID().slice(0, 8);
      logger.error(`[cita-manual] Falla no clasificada ref=${ref}:`, err);
      res.status(500).json({
        error: "ERROR_AGENDA",
        mensaje: `No se pudo registrar la cita. Comparte esta referencia con soporte: ${ref}.`,
        ref,
      });
    }
  });

  return router;
}