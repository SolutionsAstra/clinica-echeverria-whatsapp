/**
 * Agenda por doctor.
 *
 *   ┌ Doctor: (•) Dra. Salas  ( ) Dr. Rojas …            [Vista unificada 🔒] ┐
 *   │ ‹  29 sep – 5 oct  ›  Hoy                                               │
 *   │ ┌─────────── calendario (1 doctor) ───────────┐ ┌ En espera del agente ┐│
 *   │ │                                              │ │ 1. Ana   hace 9 h    ││  ≥ 2xl: a la derecha
 *   │ └──────────────────────────────────────────────┘ │ Horario de atención  ││  <  2xl: debajo, en 2 columnas
 *
 * Plan base: un calendario a la vez, para procesar lo que el agente IA 24/7 derivó fuera del
 * horario laboral en orden de llegada. La vista unificada pertenece al módulo Multi-Calendario.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Layers, Lock, Plus } from "lucide-react";
import { actualizarHorario, textoDeError } from "../../../api/panel";
import CalendarioDoctor from "../calendario/CalendarioDoctor";
import { derivacionesEnEspera, lunesDe, sumarDias } from "../calendario/semana";
import { MENSAJES, MODULO, esBloqueoPremium, estadoModulo } from "../plan/plan";
import { diaEnZona } from "../workspace/agenda";
import { especialidad } from "../workspace/especialidades";
import { FOCO } from "../workspace/tokens";
import { BOTON_FANTASMA, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA, SUPERFICIE } from "../ui/estilos";
import { fechaHora, fechaLarga } from "../ui/formato";
import { DialogoPremium, EnlaceAstra } from "../ui/Premium";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado } from "../ui/Vista";
import DialogoCitaManual from "../workspace/DialogoCitaManual";

const DIAS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [0, "Dom"],
];

const fmtRango = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "numeric", month: "short" });
const rangoSemana = (lunes) =>
  `${fmtRango.format(new Date(`${lunes}T12:00:00Z`))} – ${fmtRango.format(new Date(`${sumarDias(lunes, 6)}T12:00:00Z`))}`;

function haceCuanto(iso, ahora) {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

function SelectorDoctor({ doctores, seleccionado, onElegir, deshabilitado }) {
  return (
    <div role="radiogroup" aria-label="Doctor" className="flex flex-wrap gap-2">
      {doctores.map((d) => {
        const activo = d.id === seleccionado;
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={activo}
            disabled={deshabilitado}
            onClick={() => onElegir(d.id)}
            className={`inline-flex h-9 cursor-pointer items-center gap-2.5 rounded-md border px-3.5 text-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${FOCO} ${
              activo
                ? "border-[#E6E9EE] bg-[#E6E9EE] font-medium text-[#0B192C]"
                : "border-[#1E3350] text-[#C7CCD3] hover:border-[#3A4F6E] hover:text-[#E6E9EE]"
            }`}
          >
            <span aria-hidden className="flex gap-1">
              {(d.especialidades ?? []).map((codigo) => (
                <span key={codigo} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: especialidad(codigo).color }} />
              ))}
            </span>
            {d.nombre}
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor de la vista unificada. Sin el módulo, abre el aviso comercial en lugar de cambiar. */
function InterruptorUnificado({ activo, habilitado, onCambiar }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={onCambiar}
      className={`inline-flex h-9 cursor-pointer items-center gap-3 rounded-md border px-3.5 text-sm transition-colors duration-200 ${FOCO} ${
        habilitado ? "border-[#243B5A] text-[#E6E9EE] hover:bg-[#12284A]/60" : "border-dashed border-[#2A4266] text-[#A3AEBD] hover:border-[#3A4F6E]"
      }`}
    >
      <Layers aria-hidden className="h-4 w-4" strokeWidth={1.5} />
      Vista unificada
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full border transition-colors duration-200 ${
          activo ? "border-[#E6E9EE] bg-[#E6E9EE]" : "border-[#3A4F6E]"
        }`}
      >
        <span
          className={`absolute top-[1px] h-3 w-3 rounded-full transition-[left,background-color] duration-200 ${
            activo ? "left-[13px] bg-[#0B192C]" : "left-[1px] bg-[#7D8BA0]"
          }`}
        />
      </span>
      {!habilitado && <Lock aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  );
}

function EsperaAgente({ derivaciones, ahora, onAbrirBandeja }) {
  return (
    <section aria-labelledby="espera-titulo" className={`${SUPERFICIE} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="espera-titulo" className="text-sm font-semibold text-[#E6E9EE]">
          En espera del agente IA
        </h2>
        <span className="text-xs tabular-nums text-[#7D8BA0]">{derivaciones.length}</span>
      </div>
      <p className="mt-1 text-xs text-[#7D8BA0]">Por orden de llegada, la más antigua primero.</p>
      {derivaciones.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-[#A3AEBD]">
          <Inbox aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          Nada pendiente para este doctor.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-[#1A2D48]">
          {derivaciones.slice(0, 6).map((d, i) => (
            <li key={d.id} className="flex items-baseline gap-3 py-2.5">
              <span className="w-4 shrink-0 text-xs tabular-nums text-[#7D8BA0]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[#E6E9EE]">{d.paciente}</span>
              <time dateTime={d.capturadaEn} className="shrink-0 text-xs tabular-nums text-[#7D8BA0]">
                {haceCuanto(d.capturadaEn, ahora)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {derivaciones.length > 0 && (
        <button type="button" onClick={onAbrirBandeja} className={`${BOTON_SECUNDARIO} mt-4 w-full`}>
          Agendar en la bandeja
        </button>
      )}
    </section>
  );
}

/** Editor del horario. Se monta con key={doctor.id}: al cambiar de doctor arranca con su horario. */
function HorarioDoctor({ doctor, editable, onGuardado }) {
  const h = doctor.horario ?? {};
  const [dias, setDias] = useState(() => new Set(h.dias ?? [1, 2, 3, 4, 5]));
  const [inicio, setInicio] = useState(h.hora_inicio ?? "08:00");
  const [fin, setFin] = useState(h.hora_fin ?? "16:00");
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const alternar = (d) =>
    setDias((prev) => {
      const s = new Set(prev);
      if (s.has(d)) s.delete(d);
      else s.add(d);
      return s;
    });

  const invalido = dias.size === 0 ? "Elige al menos un día." : inicio >= fin ? "La hora de fin debe ser posterior a la de inicio." : null;

  const guardar = async () => {
    setGuardando(true);
    setResultado(null);
    try {
      await actualizarHorario(doctor.id, { dias: [...dias].sort((a, b) => a - b), hora_inicio: inicio, hora_fin: fin });
      setResultado({ tipo: "ok", texto: "Horario guardado." });
      onGuardado();
    } catch (err) {
      setResultado({ tipo: "error", texto: textoDeError(err) });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section aria-labelledby="horario-titulo" className={`${SUPERFICIE} p-5`}>
      <h2 id="horario-titulo" className="text-sm font-semibold text-[#E6E9EE]">
        Horario de atención
      </h2>
      {!editable && <p className="mt-1 text-xs text-[#7D8BA0]">Solo Dirección puede cambiarlo.</p>}

      <fieldset disabled={!editable || guardando} className="mt-4">
        <legend className={ETIQUETA}>Días</legend>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map(([d, nombre]) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias.has(d)}
              onClick={() => alternar(d)}
              className={`h-8 w-11 cursor-pointer rounded-md border text-xs transition-colors duration-200 disabled:cursor-not-allowed ${FOCO} ${
                dias.has(d) ? "border-[#A3AEBD] text-[#F2F4F7]" : "border-[#1E3350] text-[#7D8BA0] hover:border-[#3A4F6E]"
              }`}
            >
              {nombre}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className={ETIQUETA}>Desde</span>
            <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Hasta</span>
            <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} className={CAMPO} />
          </label>
        </div>
      </fieldset>

      {editable && (
        <div className="mt-5 space-y-3">
          {invalido && <p className="text-xs text-[#F2A7A0]">{invalido}</p>}
          <button type="button" onClick={guardar} disabled={Boolean(invalido) || guardando} className={`${BOTON_PRIMARIO} w-full`}>
            {guardando ? "Guardando…" : "Guardar horario"}
          </button>
          <Resultado resultado={resultado} />
        </div>
      )}
    </section>
  );
}

export default function DoctoresView({ doctores, citas, derivaciones, plan, ahora, usuario, onIrADerivaciones }) {
  const rol = usuario?.rol;
  const esDoctor = rol === "doctor";
  const [elegido, setElegido] = useState(null);
  const [lunes, setLunes] = useState(() => lunesDe(diaEnZona(ahora)));
  const [unificada, setUnificada] = useState(false);
  const [aviso, setAviso] = useState(false);
  const [citaManual, setCitaManual] = useState({ abierto: false, apertura: 0 });
  const [resultadoCita, setResultadoCita] = useState(null);
  const puedeAgendar = rol === "recepcion" || rol === "direccion";
  const notificaciones = estadoModulo(plan.datos, MODULO.NOTIFICACIONES, ahora);
  const bandejaBloqueada = esBloqueoPremium(derivaciones.error);
  const multi = estadoModulo(plan.datos, MODULO.MULTI_CALENDARIO, ahora);
  const lista = useMemo(() => {
    const todos = doctores.datos ?? [];
    return esDoctor ? todos.filter((d) => d.id === usuario?.doctor_id) : todos;
  }, [doctores.datos, esDoctor, usuario?.doctor_id]);

  const doctor = lista.find((d) => d.id === elegido) ?? lista[0] ?? null;
  const vistaUnificada = unificada && multi.habilitado && !esDoctor;
  const enEspera = useMemo(
    () => (doctor ? derivacionesEnEspera(derivaciones.datos, doctor.id) : []),
    [derivaciones.datos, doctor],
  );
  const hoyLunes = lunesDe(diaEnZona(ahora));

  const alternarUnificada = () => {
    if (!multi.habilitado) setAviso(true);
    else setUnificada((v) => !v);
  };
  const abrirCitaManual = () => setCitaManual((c) => ({ abierto: true, apertura: c.apertura + 1 }));
  const cerrarCitaManual = () => setCitaManual((c) => ({ ...c, abierto: false }));

  /** Tras agendar: muestra la semana y el doctor de la cita nueva y recarga la agenda. */
  const citaAgendada = (cita) => {
    cerrarCitaManual();
    setElegido(cita.doctorId);
    setLunes(lunesDe(diaEnZona(Date.parse(cita.start))));
    setResultadoCita({
      tipo: "ok",
      texto: `Cita agendada: ${cita.paciente}, ${fechaLarga(cita.start)}, con ${cita.doctorName}. La confirmación sale por WhatsApp en este momento.`,
    });
    citas.recargar();
  };
  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo={esDoctor ? "Mi agenda" : "Doctores y horarios"}
        descripcion={
          esDoctor
            ? "Tu semana, con cada cita en el color de su especialidad."
            : "Un doctor a la vez: revisa su semana y procesa en orden de llegada lo que el agente IA recibió fuera de horario."
        }
      >
                {!esDoctor && <InterruptorUnificado activo={vistaUnificada} habilitado={multi.habilitado} onCambiar={alternarUnificada} />}
        {puedeAgendar && (
          <button type="button" onClick={abrirCitaManual} disabled={lista.length === 0} className={BOTON_PRIMARIO}>
            <Plus aria-hidden className="h-4 w-4" strokeWidth={2} />
            Agendar Cita Manual
          </button>
        )}
      </EncabezadoVista>

      {doctores.cargando && !doctores.datos ? (
        <CargaVista filas={3} />
      ) : doctores.error && !doctores.datos ? (
        <ErrorVista error={doctores.error} onReintentar={doctores.recargar} />
      ) : !doctor ? (
        <ErrorVista titulo="No hay doctores para mostrar." detalle="Tu cuenta no tiene un doctor asociado. Pídele a Dirección que lo revise." />
      ) : (
        <>
          {!esDoctor && (
            <SelectorDoctor doctores={lista} seleccionado={doctor.id} onElegir={setElegido} deshabilitado={vistaUnificada} />
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Semana anterior" onClick={() => setLunes((l) => sumarDias(l, -7))} className={BOTON_FANTASMA}>
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </button>
            <p aria-live="polite" className="min-w-[9.5rem] text-center text-sm font-medium tabular-nums text-[#E6E9EE]">
              {rangoSemana(lunes)}
            </p>
            <button type="button" aria-label="Semana siguiente" onClick={() => setLunes((l) => sumarDias(l, 7))} className={BOTON_FANTASMA}>
              <ChevronRight aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setLunes(hoyLunes)} disabled={lunes === hoyLunes} className={`${BOTON_FANTASMA} ml-1`}>
              Esta semana
            </button>
            {citas.actualizadoEn && (
              <span className="ml-auto text-xs text-[#7D8BA0]">Actualizado {fechaHora(citas.actualizadoEn)}</span>
            )}
          </div>

          {resultadoCita && (
            <div className="mt-4">
              <Resultado resultado={resultadoCita} />
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              {citas.error && !citas.datos ? (
                <ErrorVista error={citas.error} onReintentar={citas.recargar} />
              ) : (
                <CalendarioDoctor
                  citas={citas.datos ?? []}
                  doctorId={doctor.id}
                  horario={vistaUnificada ? undefined : doctor.horario}
                  lunes={lunes}
                  ahora={ahora}
                  unificada={vistaUnificada}
                  notificacionesHabilitadas={notificaciones.habilitado}
                  puedeRecordar={puedeAgendar}
                />
              )}
            </div>

            <div className="grid content-start gap-6 lg:grid-cols-2 2xl:grid-cols-1">
              {!esDoctor && !bandejaBloqueada && (
                <EsperaAgente derivaciones={enEspera} ahora={ahora} onAbrirBandeja={onIrADerivaciones} />
              )}
              <HorarioDoctor key={doctor.id} doctor={doctor} editable={rol === "direccion"} onGuardado={doctores.recargar} />
            </div>
          </div>
        </>
      )}
      {puedeAgendar && (
        <DialogoCitaManual
          key={citaManual.apertura}
          abierto={citaManual.abierto}
          onCerrar={cerrarCitaManual}
          doctores={lista}
          doctorInicial={doctor?.id ?? null}
          ahora={ahora}
          onAgendada={citaAgendada}
        />
      )}
      <DialogoPremium
        abierto={aviso}
        onCerrar={() => setAviso(false)}
        titulo="Multi-Calendario Unificado"
        mensaje={MENSAJES[MODULO.MULTI_CALENDARIO]}
      >
        <EnlaceAstra />
      </DialogoPremium>
    </ContenedorVista>
  );
}
