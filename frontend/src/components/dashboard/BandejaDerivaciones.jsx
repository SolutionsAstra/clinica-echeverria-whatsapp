/**
 * BandejaDerivaciones.jsx
 * Bandeja de derivaciones de la IA — Clínica Echeverría
 *
 * Stack: React 18 + Tailwind CSS 3.3+ + lucide-react
 *   npm i lucide-react
 *
 * Tipografía: Geist (añádela en index.html)
 *   <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
 *
 * Uso:
 *   <BandejaDerivaciones solicitudes={data} onReservar={miFuncionQueLlamaAlBackend} />
 *   Sin props, arranca con datos de demostración y simula el webhook de WhatsApp.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Loader2,
  MessageCircle,
  Search,
  Sun,
  Sunset,
} from "lucide-react";
import { ESPECIALIDADES } from "./workspace/especialidades";

/* ────────────────────────────────────────────────────────────────────────────
 * Configuración de dominio
 * Las claves y duraciones replican src/modules/vet/domain/specialty del backend.
 * Especialidades (colores y duraciones): workspace/especialidades.js, compartido con el calendario.
 * ──────────────────────────────────────────────────────────────────────────── */

const CLINICA = {
  aperturaMin: 8 * 60, // 08:00
  cierreMin: 17 * 60, // 17:00 — la cita debe terminar antes del cierre
  mediodia: "12:00", // frontera entre bloque Mañana y Tarde
  offset: "-04:00", // America/Caracas, igual que el contrato de /api/vet
};

const BLOQUES = {
  manana: { nombre: "Mañana", Icono: Sun },
  tarde: { nombre: "Tarde", Icono: Sunset },
};

const MENSAJES_ERROR = {
  SLOT_TAKEN: "Esa hora se acaba de ocupar. Elige otra.",
  SLOT_NOT_OFFERED: "Esa hora ya no está disponible para este día. Elige otra.",
  BUSY_RETRY: "El sistema está ocupado. Intenta de nuevo en unos segundos.",
  INVALID_INPUT: "Faltan datos del paciente. Revisa la solicitud antes de reservar.",
  DEFAULT: "No se pudo reservar. Revisa la conexión e intenta de nuevo.",
};

/* Rejilla de columnas compartida por la cabecera y las filas (≥ lg). */
const COLUMNAS =
  "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_11.5rem]";

const FOCO =
  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#C7CCD3]";

/* ────────────────────────────────────────────────────────────────────────────
 * Datos de demostración (misma forma que debe devolver el backend)
 * ──────────────────────────────────────────────────────────────────────────── */
const haceMin = (m) => new Date(Date.now() - m * 60000).toISOString();

const SOLICITUDES_DEMO = [
  { id: "drv_1041", paciente: "Ana Pérez", telefono: "584141234567", especialidad: "neurologia", bloque: "manana", fecha: "2026-09-28", doctorId: 1, doctorName: "Dr. Rojas", capturadaEn: haceMin(42), notas: "Cefalea recurrente desde hace 3 semanas" },
  { id: "drv_1042", paciente: "Mateo Díaz", acudiente: "Carolina Díaz", telefono: "584241987654", especialidad: "pediatria", bloque: "tarde", fecha: "2026-09-28", doctorId: 2, doctorName: "Dra. Salas", capturadaEn: haceMin(35) },
  { id: "drv_1043", paciente: "Luis Carrillo", telefono: "584125550192", especialidad: "eeg", bloque: "manana", fecha: "2026-09-29", doctorId: 5, doctorName: "Dra. Méndez", capturadaEn: haceMin(28), horasDisponibles: ["08:00", "12:00", "14:00"] },
  { id: "drv_1044", paciente: "Valentina Rojas", telefono: "584163347781", especialidad: "estetica", bloque: "tarde", fecha: "2026-09-28", doctorId: 3, doctorName: "Dr. Núñez", capturadaEn: haceMin(19), notas: "Consulta valorativa" },
  { id: "drv_1045", paciente: "José Gregorio Lara", telefono: "584267712043", especialidad: "neurologia", bloque: "tarde", fecha: "2026-09-29", doctorId: 1, doctorName: "Dr. Rojas", capturadaEn: haceMin(11) },
  { id: "drv_1046", paciente: "Sofía Márquez", acudiente: "Daniela Márquez", telefono: "584149906611", especialidad: "pediatria", bloque: "manana", fecha: "2026-09-29", doctorId: 2, doctorName: "Dra. Salas", capturadaEn: haceMin(4) },
];

/**
 * Simula el backend: reserva la cita y dispara el webhook de confirmación a WhatsApp.
 * En producción reemplázalo por una llamada a TU servidor (nunca directo a Meta
 * ni a /api/vet con x-api-key desde el navegador).
 */
async function simularReservaYNotificacion(payload) {
  console.info("[simulación] Reservar & Notificar →", payload);
  await new Promise((r) => setTimeout(r, 900));
  return { appointmentId: Math.floor(Math.random() * 90000) + 10000, whatsapp: "enviado" };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Utilidades
 * ──────────────────────────────────────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, "0");
const aHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function sumarMinutos(hhmm, minutos) {
  const [h, m] = hhmm.split(":").map(Number);
  return aHHMM(h * 60 + m + minutos);
}

function generarHorarios(duracionMin) {
  const horas = [];
  for (let m = CLINICA.aperturaMin; m + duracionMin <= CLINICA.cierreMin; m += duracionMin) {
    horas.push(aHHMM(m));
  }
  return horas;
}

function formatearTelefono(raw) {
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("58")) {
    return `+58 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  return `+${d}`;
}

function formatearFecha(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-VE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function haceCuanto(iso, ahora) {
  const min = Math.round((new Date(iso).getTime() - ahora) / 60000);
  if (min === 0) return "ahora mismo";
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

/** Mismo contrato que POST /api/vet/citas. */
function construirPayload(s, hora) {
  return {
    derivacionId: s.id,
    especialidad: s.especialidad,
    doctorId: s.doctorId,
    inicio: `${s.fecha}T${hora}:00${CLINICA.offset}`,
    paciente: {
      telefono: s.telefono,
      nombre: s.paciente,
      esMenor: Boolean(s.acudiente),
      nombreAcudiente: s.acudiente ?? null,
    },
    notas: s.notas ?? null,
  };
}

const leerCodigoError = (err) => err?.code ?? err?.response?.data?.error ?? "DEFAULT";

function useAhora(intervaloMs = 60000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return ahora;
}

/* ────────────────────────────────────────────────────────────────────────────
 * TimePicker
 * ──────────────────────────────────────────────────────────────────────────── */
function TimePicker({ value, onChange, duracionMin, bloquePreferido, disponibles, disabled, etiqueta }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef(null);
  const disparador = useRef(null);
  const panelId = useId();

  const grupos = useMemo(() => {
    const horas = generarHorarios(duracionMin);
    const lista = [
      { clave: "manana", horas: horas.filter((h) => h < CLINICA.mediodia) },
      { clave: "tarde", horas: horas.filter((h) => h >= CLINICA.mediodia) },
    ];
    // El bloque preferido por el paciente siempre aparece primero.
    return bloquePreferido === "tarde" ? lista.reverse() : lista;
  }, [duracionMin, bloquePreferido]);

  const libres = useMemo(() => (disponibles ? new Set(disponibles) : null), [disponibles]);

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) disparador.current?.focus();
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    const alClic = (e) => {
      if (!raiz.current?.contains(e.target)) cerrar(false);
    };
    const alTecla = (e) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("mousedown", alClic);
    document.addEventListener("keydown", alTecla);
    const destino =
      raiz.current?.querySelector('[aria-selected="true"]') ??
      raiz.current?.querySelector('[role="option"]:not(:disabled)');
    destino?.focus();
    return () => {
      document.removeEventListener("mousedown", alClic);
      document.removeEventListener("keydown", alTecla);
    };
  }, [abierto, cerrar]);

  return (
    <div ref={raiz} className="relative">
      <button
        ref={disparador}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={panelId}
        aria-label={`${etiqueta}: ${value ?? "sin hora elegida"}`}
        onClick={() => setAbierto((v) => !v)}
        className={`flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border bg-[#0B192C] px-3 text-sm transition-colors duration-200 hover:border-[#3A4F6E] disabled:cursor-not-allowed disabled:opacity-50 ${
          abierto ? "border-[#A3AEBD]" : "border-[#1E3350]"
        } ${FOCO}`}
      >
        <Clock className="h-4 w-4 shrink-0 text-[#7D8BA0]" aria-hidden />
        {value ? (
          <span className="tabular-nums text-[#E6E9EE]">
            {value}
            <span className="text-[#7D8BA0]"> – {sumarMinutos(value, duracionMin)}</span>
          </span>
        ) : (
          <span className="text-[#A3AEBD]">Elegir hora</span>
        )}
        <ChevronDown
          aria-hidden
          className={`ml-auto h-4 w-4 shrink-0 text-[#7D8BA0] transition-transform duration-200 motion-reduce:transition-none ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>

      {abierto && (
        <div
          id={panelId}
          role="listbox"
          aria-label={etiqueta}
          className="absolute left-0 top-full z-30 mt-2 w-[17.5rem] rounded-lg border border-[#243B5A] bg-[#0E1F36] p-3 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]"
        >
          <p className="px-1 pb-3 text-xs text-[#A3AEBD]">Cada cita dura {duracionMin} min</p>
          <div className="space-y-4">
            {grupos.map(({ clave, horas }) => {
              if (horas.length === 0) return null;
              const { nombre, Icono } = BLOQUES[clave];
              return (
                <div key={clave} role="group" aria-label={nombre}>
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-[#A3AEBD]">
                    <Icono className="h-3.5 w-3.5" aria-hidden />
                    {nombre}
                    {clave === bloquePreferido && (
                      <span className="ml-auto text-[#E6E9EE]">Preferido por el paciente</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {horas.map((h) => {
                      const ocupada = libres ? !libres.has(h) : false;
                      const elegida = h === value;
                      return (
                        <button
                          key={h}
                          type="button"
                          role="option"
                          aria-selected={elegida}
                          disabled={ocupada}
                          title={ocupada ? "Hora ocupada" : undefined}
                          onClick={() => {
                            onChange(h);
                            cerrar();
                          }}
                          className={`h-8 cursor-pointer rounded-md border text-sm tabular-nums transition-colors duration-150 disabled:cursor-not-allowed disabled:border-transparent disabled:text-[#52627A] disabled:line-through ${
                            elegida
                              ? "border-[#E6E9EE] bg-[#E6E9EE] font-medium text-[#0B192C]"
                              : "border-[#1E3350] text-[#E6E9EE] hover:border-[#3A4F6E] hover:bg-[#13294A]"
                          } ${FOCO}`}
                        >
                          {h}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fila
 * ──────────────────────────────────────────────────────────────────────────── */
function Etiqueta({ children }) {
  return <span className="mb-1 block text-xs text-[#7D8BA0] lg:hidden">{children}</span>;
}

function FilaDerivacion({ s, borrador, ahora, onHora, onReservar }) {
  const esp = ESPECIALIDADES[s.especialidad];
  const bloque = BLOQUES[s.bloque];
  const { hora = null, estado = "inactivo", error = null } = borrador ?? {};
  const enviando = estado === "enviando";
  const enviado = estado === "enviado";

  let botonClases =
    "border-[#E6E9EE] bg-[#E6E9EE] text-[#0B192C] hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[#1E3350] disabled:bg-transparent disabled:text-[#7D8BA0] disabled:active:scale-100";
  if (enviado) botonClases = "cursor-default border-[#2C5B53] bg-transparent text-[#86D5BC]";

  return (
    <li
      className={`relative grid grid-cols-2 gap-x-4 gap-y-4 border-b border-[#1A2D48] px-5 py-5 transition-[opacity,background-color] duration-300 last:border-b-0 hover:bg-[#0E203A] motion-reduce:transition-none lg:items-center lg:gap-6 lg:px-6 lg:py-4 ${COLUMNAS} ${
        enviado ? "opacity-60" : ""
      }`}
    >
      <span aria-hidden className="absolute inset-y-4 left-0 w-px" style={{ backgroundColor: esp.color }} />

      {/* Paciente */}
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="truncate text-sm font-medium text-[#E6E9EE]">{s.paciente}</p>
        <p className="mt-1 truncate text-xs text-[#7D8BA0]">
          {s.acudiente ? `Acudiente: ${s.acudiente}` : s.notas ?? "Sin notas"}
        </p>
        <p className="mt-0.5 text-xs text-[#7D8BA0]">
          <time dateTime={s.capturadaEn}>Recibida {haceCuanto(s.capturadaEn, ahora)}</time>
        </p>
      </div>

      {/* Teléfono */}
      <div className="min-w-0">
        <Etiqueta>Teléfono</Etiqueta>
        <a
          href={`tel:+${String(s.telefono).replace(/\D/g, "")}`}
          className={`rounded-sm text-sm tabular-nums text-[#C7CCD3] transition-colors duration-200 hover:text-white ${FOCO}`}
        >
          {formatearTelefono(s.telefono)}
        </a>
      </div>

      {/* Especialidad */}
      <div className="min-w-0">
        <Etiqueta>Especialidad</Etiqueta>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#1E3350] px-2.5 py-1 text-xs text-[#E6E9EE]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: esp.color }} />
          {esp.nombre}
        </span>
        <p className="mt-1.5 truncate text-xs text-[#7D8BA0]">{s.doctorName}</p>
      </div>

      {/* Preferencia */}
      <div className="min-w-0">
        <Etiqueta>Preferencia</Etiqueta>
        <p className="flex items-center gap-1.5 text-sm text-[#E6E9EE]">
          <bloque.Icono className="h-4 w-4 text-[#A3AEBD]" aria-hidden />
          {bloque.nombre}
        </p>
        <p className="mt-1 text-xs capitalize text-[#7D8BA0]">{formatearFecha(s.fecha)}</p>
      </div>

      {/* Hora */}
      <div className="col-span-2 min-w-0 sm:col-span-1 lg:col-span-1">
        <Etiqueta>Hora exacta</Etiqueta>
        <TimePicker
          value={hora}
          onChange={(h) => onHora(s.id, h)}
          duracionMin={esp.duracionMin}
          bloquePreferido={s.bloque}
          disponibles={s.horasDisponibles}
          disabled={enviando || enviado}
          etiqueta={`Hora para ${s.paciente}`}
        />
        {error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-[#F2A7A0]">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>

      {/* Acción */}
      <div className="col-span-2 sm:col-span-1 sm:self-end lg:col-span-1 lg:self-center">
        <button
          type="button"
          onClick={() => !enviado && onReservar(s)}
          disabled={!hora || enviando}
          aria-disabled={enviado}
          title={!hora ? "Elige una hora primero" : undefined}
          className={`inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 text-sm font-medium transition-[background-color,border-color,color,transform] duration-200 motion-reduce:transition-none ${botonClases} ${FOCO}`}
        >
          {enviando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Notificando…
            </>
          ) : enviado ? (
            <>
              <Check className="h-4 w-4" aria-hidden />
              Reservada y notificada
            </>
          ) : (
            <>
              <MessageCircle className="h-4 w-4" aria-hidden />
              Reservar &amp; Notificar
            </>
          )}
        </button>
      </div>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bandeja
 * ──────────────────────────────────────────────────────────────────────────── */
export default function BandejaDerivaciones({
  solicitudes = SOLICITUDES_DEMO,
  onReservar = simularReservaYNotificacion,
}) {
  const [pendientes, setPendientes] = useState(solicitudes);
  const [borradores, setBorradores] = useState({});
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState(null);
  const temporizadores = useRef([]);
  const ahora = useAhora();

  //useEffect(() => setPendientes(solicitudes), [solicitudes]);
  useEffect(() => () => temporizadores.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  const actualizar = useCallback((id, cambios) => {
    setBorradores((b) => ({ ...b, [id]: { ...b[id], ...cambios } }));
  }, []);

  const elegirHora = useCallback((id, hora) => actualizar(id, { hora, error: null, estado: "inactivo" }), [actualizar]);

  const reservar = useCallback(
    async (s) => {
      const hora = borradores[s.id]?.hora;
      if (!hora) return;
      actualizar(s.id, { estado: "enviando", error: null });
      try {
        await onReservar(construirPayload(s, hora), s);
        actualizar(s.id, { estado: "enviado" });
        setAviso({
          id: `${s.id}-${Date.now()}`,
          texto: `Cita reservada a las ${hora}. ${s.paciente} recibió la confirmación por WhatsApp.`,
        });
        const t = setTimeout(() => {
          setPendientes((lista) => lista.filter((x) => x.id !== s.id));
          setBorradores(({ ...resto }) => resto);
        }, 1400);
        temporizadores.current.push(t);
      } catch (err) {
        const codigo = leerCodigoError(err);
        const horaPerdida = codigo === "SLOT_TAKEN" || codigo === "SLOT_NOT_OFFERED";
        actualizar(s.id, {
          estado: "error",
          error: MENSAJES_ERROR[codigo] ?? MENSAJES_ERROR.DEFAULT,
          ...(horaPerdida ? { hora: null } : {}),
        });
      }
    },
    [borradores, onReservar, actualizar],
  );

  const conteo = useMemo(() => {
    const c = { todas: pendientes.length };
    for (const s of pendientes) c[s.especialidad] = (c[s.especialidad] ?? 0) + 1;
    return c;
  }, [pendientes]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const qDigitos = q.replace(/\D/g, "");
    return pendientes
      .filter((s) => filtro === "todas" || s.especialidad === filtro)
      .filter(
        (s) =>
          !q ||
          s.paciente.toLowerCase().includes(q) ||
          (s.acudiente ?? "").toLowerCase().includes(q) ||
          (qDigitos && s.telefono.includes(qDigitos)),
      )
      .sort((a, b) => new Date(a.capturadaEn) - new Date(b.capturadaEn)); // la más antigua primero
  }, [pendientes, filtro, busqueda]);

  const opcionesFiltro = [
    { clave: "todas", nombre: "Todas" },
    ...Object.entries(ESPECIALIDADES).map(([clave, v]) => ({ clave, nombre: v.nombre, color: v.color })),
  ];

  return (
    <div className="min-h-screen bg-[#0B192C] font-['Geist',ui-sans-serif,system-ui,sans-serif] text-[#E6E9EE] antialiased">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-[#F2F4F7]">Derivaciones de la IA</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#A3AEBD]">
            Solicitudes que el asistente de WhatsApp dejó listas para agendar. Elige la hora exacta y reserva:
            el paciente recibe la confirmación en el momento.
          </p>
        </header>

        {/* Filtros y búsqueda */}
        <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div role="radiogroup" aria-label="Filtrar por especialidad" className="flex flex-wrap gap-1">
            {opcionesFiltro.map((o) => {
              const activo = filtro === o.clave;
              return (
                <button
                  key={o.clave}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => setFiltro(o.clave)}
                  className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors duration-200 ${
                    activo
                      ? "border-[#243B5A] bg-[#12284A] text-[#E6E9EE]"
                      : "border-transparent text-[#A3AEBD] hover:text-[#E6E9EE]"
                  } ${FOCO}`}
                >
                  {o.color && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: o.color }} />}
                  {o.nombre}
                  <span className="tabular-nums text-[#7D8BA0]">{conteo[o.clave] ?? 0}</span>
                </button>
              );
            })}
          </div>

          <label className="relative block md:w-72">
            <span className="sr-only">Buscar por nombre o teléfono</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7D8BA0]" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o teléfono"
              className="h-9 w-full rounded-md border border-[#1E3350] bg-transparent pl-9 pr-3 text-sm text-[#E6E9EE] placeholder:text-[#7D8BA0] transition-colors duration-200 hover:border-[#3A4F6E] focus:border-[#A3AEBD] focus:outline-none"
            />
          </label>
        </div>

        {/* Tabla */}
        <section aria-label="Solicitudes pendientes" className="mt-4 rounded-lg border border-[#1A2D48]">
          <div
            aria-hidden
            className={`hidden border-b border-[#1A2D48] px-6 py-3 text-xs text-[#7D8BA0] lg:grid lg:gap-6 ${COLUMNAS}`}
          >
            <span>Paciente</span>
            <span>Teléfono</span>
            <span>Especialidad</span>
            <span>Preferencia</span>
            <span>Hora exacta</span>
            <span className="sr-only">Acción</span>
          </div>

          {visibles.length > 0 ? (
            <ul>
              {visibles.map((s) => (
                <FilaDerivacion
                  key={s.id}
                  s={s}
                  borrador={borradores[s.id]}
                  ahora={ahora}
                  onHora={elegirHora}
                  onReservar={reservar}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-6 py-20 text-center">
              <Inbox className="h-6 w-6 text-[#7D8BA0]" aria-hidden />
              <p className="mt-4 text-sm font-medium text-[#E6E9EE]">
                {pendientes.length === 0 ? "No hay derivaciones pendientes" : "Ninguna solicitud coincide"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-[#A3AEBD]">
                {pendientes.length === 0
                  ? "Las nuevas solicitudes del asistente de WhatsApp aparecerán aquí."
                  : "Cambia el filtro de especialidad o borra la búsqueda."}
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Aviso de confirmación */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 sm:justify-end sm:p-6"
      >
        {aviso && (
          <div
            key={aviso.id}
            className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border border-[#243B5A] bg-[#0E1F36] px-4 py-3 text-sm text-[#E6E9EE] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#86D5BC]" aria-hidden />
            <p>{aviso.texto}</p>
          </div>
        )}
      </div>
    </div>
  );
}
