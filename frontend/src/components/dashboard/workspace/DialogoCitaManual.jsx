/**
 * Diálogo "Agendar Cita Manual" (estilo Google Calendar): registra a un paciente desde cero y
 * reserva con el mismo motor de disponibilidad que el asistente de WhatsApp.
 *   POST /api/citas/manual → 201 { appointmentId, doctorId, doctorName, start, end, whatsapp: "en_cola" }
 * El paciente recibe la confirmación por WhatsApp en ese momento.
 *
 * Se monta con key distinta en cada apertura: el formulario siempre arranca limpio.
 * noValidate: los mensajes de error son nuestros y siempre en español, no los del navegador.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { agendarCitaManual, textoDeError } from "../../../api/panel";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA } from "../ui/estilos";
import { Resultado } from "../ui/Vista";
import { diaEnZona } from "./agenda";
import { validarCitaManual } from "./citaManual";
import { ORDEN_ESPECIALIDADES, especialidad as datosEspecialidad } from "./especialidades";
import { FOCO } from "./tokens";
import { CalendarClock, CalendarPlus, Loader2, X } from "lucide-react";

const MENSAJES_ERROR = {
  SLOT_TAKEN: "Ese horario se acaba de ocupar. Elige otra hora.",
  BUSY_RETRY: "El sistema está ocupado. Intenta de nuevo en unos segundos.",
  INVALID_INPUT: "Revisa los datos del paciente y la hora elegida.",
  SIN_CONEXION: "No hay conexión con el servidor. Revisa el indicador del menú.",
};

/** Rechazos del motor de reservas (vet.book): ventana del doctor, duración fija o recurso. */
const CODIGOS_VALIDACION_AGENDA = new Set(["SLOT_NOT_OFFERED", "INVALID_DURATION", "DURATION_MISMATCH", "RESOURCE_NOT_CONFIGURED"]);

function clasificarFalla(err) {
  const codigo = err?.code;
  if (MENSAJES_ERROR[codigo]) return { tipo: "error", texto: MENSAJES_ERROR[codigo] };
  // El 500 del motor de reservas se presenta como validación de agenda, nunca como "Error interno del servidor".
  if (CODIGOS_VALIDACION_AGENDA.has(codigo) || (err?.status ?? 0) >= 500) return { tipo: "validacion" };
  return { tipo: "error", texto: textoDeError(err) };
}

function AvisoReserva({ falla }) {
  if (!falla) return null;
  if (falla.tipo !== "validacion") return <Resultado resultado={falla} />;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-[#4A4230] bg-[#0B192C]/60 px-4 py-3 text-sm leading-relaxed text-[#C7CCD3]"
    >
      <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#C9AE72]" strokeWidth={1.5} />
      <p>
        <span className="font-medium text-[#E6E9EE]">Validación de Agenda:</span> {VALIDACION_AGENDA}
      </p>
    </div>
  );
}
const tieneEspecialidad = (doctor, codigo) => (doctor.especialidades ?? []).includes(codigo);

function Campo({ id, etiqueta, error, className = "", children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={ETIQUETA}>
        {etiqueta}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-[#F2A7A0]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Atributos de accesibilidad de un control con posible error. */
const aria = (id, error) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : undefined,
});

export default function DialogoCitaManual({ abierto, onCerrar, doctores, doctorInicial, ahora, onAgendada }) {
  const ref = useRef(null);
  const base = useId();
  const id = (campo) => `${base}-${campo}`;
  const hoy = diaEnZona(ahora);

  const [campos, setCampos] = useState(() => {
    const doctor = doctores.find((d) => d.id === doctorInicial) ?? doctores[0];
    return {
      nombre: "",
      telefono: "",
      acudiente: "",
      especialidad: doctor?.especialidades?.[0] ?? "",
      doctorId: doctor ? String(doctor.id) : "",
      fecha: hoy,
      hora: "",
    };
  });
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState(null);

  const especialidades = useMemo(() => {
    const ofrecidas = new Set(doctores.flatMap((d) => d.especialidades ?? []));
    return ORDEN_ESPECIALIDADES.filter((codigo) => ofrecidas.has(codigo));
  }, [doctores]);
  const doctoresDeEspecialidad = useMemo(
    () => doctores.filter((d) => tieneEspecialidad(d, campos.especialidad)),
    [doctores, campos.especialidad],
  );

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) {
      dialogo.showModal();
      dialogo.querySelector("input")?.focus();
    }
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  const cambiar = (campo) => (e) => setCampos((c) => ({ ...c, [campo]: e.target.value }));

  const cambiarEspecialidad = (e) => {
    const codigo = e.target.value;
    setCampos((c) => {
      const actual = doctores.find((d) => String(d.id) === c.doctorId);
      const primero = doctores.find((d) => tieneEspecialidad(d, codigo));
      const doctorId = actual && tieneEspecialidad(actual, codigo) ? c.doctorId : primero ? String(primero.id) : "";
      return { ...c, especialidad: codigo, doctorId };
    });
  };

  const enviar = async (e) => {
    e.preventDefault();
    const { errores: encontrados, payload } = validarCitaManual(campos, Date.now());
    setErrores(encontrados);
    setFalla(null);
    if (!payload) return;

    setEnviando(true);
    try {
      const cita = await agendarCitaManual(payload);
      onAgendada({ ...cita, paciente: payload.nombre });
    } catch (err) {
      const falla = clasificarFalla(err);
      setFalla(falla);
      if (falla.tipo === "validacion") setErrores((e) => ({ ...e, hora: "Elige otra hora dentro de la ventana del doctor." }));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={id("titulo")}
      onClose={onCerrar}
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
      className="w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-[#243B5A] bg-[#0E1F36] p-0 text-[#E6E9EE] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] backdrop:bg-[#060E1A]/70 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={enviar} noValidate className="p-7 sm:p-8">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#3A4F6E] text-[#E6E9EE]"
          >
            <CalendarPlus className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={id("titulo")} className="text-lg font-semibold tracking-tight text-[#F2F4F7]">
              Agendar cita manual
            </h2>
            <p className="mt-1 text-sm text-[#A3AEBD]">
              Registra al paciente y elige la hora. Recibe la confirmación por WhatsApp al guardar.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            aria-label="Cerrar"
            className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#A3AEBD] transition-colors duration-200 hover:bg-[#12284A]/60 hover:text-[#E6E9EE] ${FOCO}`}
          >
            <X aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <fieldset disabled={enviando} className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <legend className="sr-only">Datos de la cita</legend>

          <Campo id={id("nombre")} etiqueta="Nombre del paciente" error={errores.nombre} className="sm:col-span-2">
            <input
              {...aria(id("nombre"), errores.nombre)}
              type="text"
              autoComplete="off"
              value={campos.nombre}
              onChange={cambiar("nombre")}
              placeholder="Nombre y apellido"
              className={CAMPO}
            />
          </Campo>

          <Campo id={id("telefono")} etiqueta="Teléfono (WhatsApp)" error={errores.telefono}>
            <input
              {...aria(id("telefono"), errores.telefono)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={campos.telefono}
              onChange={cambiar("telefono")}
              placeholder="0414 123 4567"
              className={`${CAMPO} tabular-nums`}
            />
          </Campo>

          <Campo id={id("especialidad")} etiqueta="Especialidad" error={errores.especialidad}>
            <select
              {...aria(id("especialidad"), errores.especialidad)}
              value={campos.especialidad}
              onChange={cambiarEspecialidad}
              className={`${CAMPO} cursor-pointer`}
            >
              <option value="">Elegir especialidad</option>
              {especialidades.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {datosEspecialidad(codigo).nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id={id("doctor")} etiqueta="Doctor" error={errores.doctorId} className="sm:col-span-2">
            <select
              {...aria(id("doctor"), errores.doctorId)}
              value={campos.doctorId}
              onChange={cambiar("doctorId")}
              disabled={doctoresDeEspecialidad.length === 0}
              className={`${CAMPO} cursor-pointer`}
            >
              {doctoresDeEspecialidad.length === 0 ? (
                <option value="">No hay doctores de esta especialidad</option>
              ) : (
                doctoresDeEspecialidad.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))
              )}
            </select>
          </Campo>

          <Campo id={id("fecha")} etiqueta="Fecha" error={null}>
            <input
              id={id("fecha")}
              type="date"
              min={hoy}
              value={campos.fecha}
              onChange={cambiar("fecha")}
              className={`${CAMPO} tabular-nums`}
            />
          </Campo>

          <Campo id={id("hora")} etiqueta="Hora (hora de la clínica)" error={errores.hora}>
            <input
              {...aria(id("hora"), errores.hora)}
              type="time"
              step={900}
              value={campos.hora}
              onChange={cambiar("hora")}
              className={`${CAMPO} tabular-nums`}
            />
          </Campo>

          {campos.especialidad === "pediatria" && (
            <Campo id={id("acudiente")} etiqueta="Acudiente (si el paciente es menor de edad)" error={null} className="sm:col-span-2">
              <input
                id={id("acudiente")}
                type="text"
                autoComplete="off"
                value={campos.acudiente}
                onChange={cambiar("acudiente")}
                placeholder="Nombre del representante"
                className={CAMPO}
              />
            </Campo>
          )}
        </fieldset>

        <div className="mt-6 min-h-5">
          <AvisoReserva falla={falla} />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[#1A2D48] pt-6">
          <button type="button" onClick={onCerrar} disabled={enviando} className={BOTON_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className={BOTON_PRIMARIO}>
            {enviando && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {enviando ? "Agendando…" : "Agendar cita"}
          </button>
        </div>
      </form>
    </dialog>
  );
}