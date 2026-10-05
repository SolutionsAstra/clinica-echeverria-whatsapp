// routes/citaManual.routes.ts
// Alta manual de citas desde el calendario del panel (recepción y dirección).
//   POST /api/citas/manual  { nombre, telefono, especialidad, doctorId, inicio, nombreAcudiente? }
//   → 201 { appointmentId, doctorId, doctorName, start, end, whatsapp: "en_cola" }
// Reserva con vetModule.scheduler en proceso (el navegador nunca usa x-api-key) y notifica por
// WhatsApp en caliente, igual que la bandeja de derivaciones.

import { Router, type NextFunction, type Request, type Response } from "express";
import { isSpecialty, isVetError } from "../modules/vet";
import { mensajeConfirmacion } from "../modules/derivaciones/domain/derivacion";
import { statusPara } from "../modules/derivaciones/http/derivaciones.router";
import type { Booker, Notifier } from "../modules/derivaciones/application/ports";

/** Hora de la clínica (UTC-4) a la que el panel siempre envía el inicio. */
const INICIO_CLINICA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/;

export function normalizarTelefono(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = `58${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith("4")) d = `58${d}`;
  return /^\d{11,15}$/.test(d) ? d : null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export function citaManualRouter({
  scheduler,
  notifier,
  logger = console,
}: {
  scheduler: Booker;
  notifier: Notifier;
  logger?: { error: (...args: unknown[]) => void };
}): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const nombre = texto(b.nombre);
    const telefono = normalizarTelefono(b.telefono);
    const doctorId = Number(b.doctorId);
    const inicio = typeof b.inicio === "string" ? b.inicio : "";
    const nombreAcudiente = texto(b.nombreAcudiente) || null;
    const especialidad = b.especialidad;

    const campos: string[] = [];
    if (nombre.length < 3 || nombre.length > 150) campos.push("nombre");
    if (!telefono) campos.push("telefono");
    if (!isSpecialty(especialidad)) campos.push("especialidad");
    if (!Number.isInteger(doctorId) || doctorId <= 0) campos.push("doctorId");
    if (!INICIO_CLINICA.test(inicio) || !(Date.parse(inicio) > Date.now())) campos.push("inicio");
    if (campos.length || !telefono || !isSpecialty(especialidad)) {
      res.status(400).json({ error: "INVALID_INPUT", mensaje: "Revisa los datos de la cita.", campos });
      return;
    }

    try {
      const booking = await scheduler.book({
        specialty: especialidad,
        doctorId,
        start: inicio,
        patient: { telefono, nombre, esMenor: Boolean(nombreAcudiente), nombreAcudiente },
        notes: null,
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
        whatsapp: "en_cola",
      });
    } catch (err) {
      const status = statusPara(err);
      if (status !== null && isVetError(err)) {
        res.status(status).json({ error: err.code, mensaje: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}