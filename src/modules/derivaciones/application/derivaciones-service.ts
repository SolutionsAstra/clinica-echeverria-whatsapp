import { isSpecialty, type Booking } from "../../vet";
import { BLOQUES, formatearId, mensajeConfirmacion, parseDerivacionId, toSolicitudDto, type Bloque, type SolicitudDto } from "../domain/derivacion";
import { DerivacionError } from "../domain/errors";
import type { Booker, DerivacionesRepository, DerivacionRow, Logger, Notifier } from "./ports";

export interface ReservaResultado {
  derivacionId: string;
  appointmentId: number;
  patientId: number;
  doctorId: number;
  doctorName: string;
  start: string;
  end: string;
  /** La notificación sale en segundo plano; su resultado queda en la derivación. */
  whatsapp: "en_cola";
}

export interface Actor {
  usuarioId: number | null;
}

export interface DerivacionesService {
  listarPendientes(): Promise<SolicitudDto[]>;
  /**
   * Reserva la cita de una derivación. Del cuerpo SOLO se toman `inicio` y, opcionalmente,
   * `doctorId`: paciente, teléfono, especialidad y notas salen de la BD, así un navegador
   * manipulado no puede agendar a otra persona ni enviar WhatsApp a un número arbitrario.
   */
  reservar(rawId: unknown, body: unknown, actor: Actor): Promise<ReservaResultado>;
  /** Alta desde el asistente de WhatsApp. Devuelve el id público (drv_<n>). */
  registrar(input: Record<string, unknown>): Promise<string>;
}

export function createDerivacionesService(deps: {
  repository: DerivacionesRepository;
  scheduler: Booker;
  notifier: Notifier;
  logger?: Logger;
}): DerivacionesService {
  const repo = deps.repository;
  const log = deps.logger ?? console;

  /**
   * Fire-and-forget: nunca rechaza ni bloquea la respuesta HTTP. setImmediate (no una
   * microtarea) garantiza que el envío arranque DESPUÉS de que Express responda.
   */
  function notificarEnSegundoPlano(d: DerivacionRow, booking: Booking): void {
    const texto = mensajeConfirmacion(d, booking);
    setImmediate(() => {
      void enviar(d, texto);
    });
  }

  function enviar(d: DerivacionRow, texto: string): Promise<void> {
    return Promise.resolve()
      .then(() => deps.notifier.enviarTexto(d.telefono, texto))
      .then(
        () => repo.marcarNotificacion(d.id, null),
        (err: unknown) => {
          log.error(`[derivaciones] WhatsApp falló para ${formatearId(d.id)}:`, err);
          return repo.marcarNotificacion(d.id, mensajeDe(err).slice(0, 500));
        },
      )
      .catch((err: unknown) => log.error(`[derivaciones] No se pudo registrar el estado de la notificación de ${formatearId(d.id)}:`, err));
  }

  return {
    async listarPendientes() {
      const rows = await repo.listarPendientes();
      return rows.map(toSolicitudDto);
    },

    async reservar(rawId, body, actor) {
      const id = parseDerivacionId(rawId);
      if (id === null) throw new DerivacionError("INVALID_INPUT", "Identificador de derivación inválido");
      const b = (body && typeof body === "object" ? body : null) as Record<string, unknown> | null;
      if (!b || typeof b.inicio !== "string" || !b.inicio.trim()) {
        throw new DerivacionError("INVALID_INPUT", "Falta 'inicio' (ISO 8601 con offset)");
      }
      let doctorOverride: number | undefined;
      if (b.doctorId !== undefined && b.doctorId !== null) {
        doctorOverride = Number(b.doctorId);
        if (!Number.isInteger(doctorOverride) || doctorOverride <= 0) {
          throw new DerivacionError("INVALID_INPUT", "doctorId inválido");
        }
      }

      // 1) Reclamo atómico: dos recepcionistas pulsando "Reservar" a la vez → solo una pasa.
      const d = await repo.reclamar(id, actor.usuarioId);
      if (!d) {
        if (await repo.existe(id)) {
          throw new DerivacionError("DERIVACION_NO_DISPONIBLE", "Otra persona ya está gestionando o reservó esta derivación");
        }
        throw new DerivacionError("NOT_FOUND", "La derivación no existe");
      }

      // 2) Reserva formal. vet.book es atómico (advisory locks + revalidación en BD).
      let booking: Booking;
      try {
        booking = await deps.scheduler.book({
          specialty: d.especialidad,
          doctorId: doctorOverride ?? d.doctorId,
          start: b.inicio,
          patient: {
            telefono: d.telefono,
            nombre: d.pacienteNombre,
            esMenor: Boolean(d.nombreAcudiente),
            nombreAcudiente: d.nombreAcudiente,
          },
          notes: d.notas,
        });
      } catch (err) {
        // Compensación: la derivación vuelve a la bandeja para elegir otra hora.
        await repo.liberar(id).catch((e: unknown) => log.error(`[derivaciones] No se pudo liberar ${formatearId(id)}:`, e));
        throw err;
      }

      // 3) Cierre. La cita YA existe: si esto falla no se revierte ni se reporta error,
      //    porque la recepcionista reintentaría y duplicaría la cita. Se deja rastro.
      try {
        await repo.marcarReservada(id, booking.appointmentId, actor.usuarioId);
      } catch (err) {
        log.error(
          `[derivaciones] CRÍTICO: cita ${booking.appointmentId} creada pero ${formatearId(id)} quedó en 'en_proceso'. Ciérrala manualmente.`,
          err,
        );
      }

      // 4) WhatsApp en segundo plano.
      notificarEnSegundoPlano(d, booking);

      return {
        derivacionId: formatearId(id),
        appointmentId: booking.appointmentId,
        patientId: booking.patientId,
        doctorId: booking.doctorId,
        doctorName: booking.doctorName,
        start: booking.start,
        end: booking.end,
        whatsapp: "en_cola",
      };
    },

    async registrar(input) {
      const telefono = String(input.telefono ?? "").replace(/\D/g, "");
      const paciente = texto(input.paciente, 150);
      const acudiente = texto(input.acudiente, 150);
      const notas = texto(input.notas, 400);
      const doctorId = Number(input.doctorId);
      const { especialidad, bloque, fecha } = input;

      if (telefono.length < 10 || telefono.length > 15) throw new DerivacionError("INVALID_INPUT", "telefono inválido");
      if (!paciente) throw new DerivacionError("INVALID_INPUT", "paciente requerido");
      if (!isSpecialty(especialidad)) throw new DerivacionError("INVALID_INPUT", "especialidad inválida");
      if (!BLOQUES.includes(bloque as Bloque)) throw new DerivacionError("INVALID_INPUT", "bloque debe ser 'manana' o 'tarde'");
      if (!esFechaValida(fecha)) throw new DerivacionError("INVALID_INPUT", "fecha debe ser YYYY-MM-DD");
      if (!Number.isInteger(doctorId) || doctorId <= 0) throw new DerivacionError("INVALID_INPUT", "doctorId inválido");

      const id = await repo.registrar({
        telefono,
        pacienteNombre: paciente,
        nombreAcudiente: acudiente,
        especialidad,
        doctorId,
        bloque: bloque as Bloque,
        fechaPreferida: fecha,
        notas,
      });
      return formatearId(id);
    },
  };
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function esFechaValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v); // rechaza 2026-02-31
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
