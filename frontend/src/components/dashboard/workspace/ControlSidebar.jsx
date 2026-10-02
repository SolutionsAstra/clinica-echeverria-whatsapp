import { useEffect, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { ZONA_CLINICA } from "./agenda";
import { ESTADO_RED, FOCO } from "./tokens";

const fmtHora = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const fmtFecha = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const ROL = { recepcion: "Recepción", direccion: "Dirección", doctor: "Doctor" };

/** Reloj aislado: solo él se vuelve a renderizar cada segundo. */
function RelojClinica() {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    let temporizador;
    const tic = () => {
      setAhora(Date.now());
      temporizador = setTimeout(tic, 1000 - (Date.now() % 1000)); // alineado al segundo
    };
    temporizador = setTimeout(tic, 1000 - (Date.now() % 1000));
    return () => clearTimeout(temporizador);
  }, []);

  const fecha = fmtFecha.format(ahora);
  return (
    <div>
      <time
        dateTime={new Date(ahora).toISOString()}
        className="block text-xl font-medium leading-none tracking-tight tabular-nums text-[#E6E9EE] xl:text-[2rem]"
      >
        {fmtHora.format(ahora)}
      </time>
      <p className="mt-1.5 text-xs text-[#A3AEBD] xl:mt-2 xl:text-sm">{fecha.charAt(0).toUpperCase() + fecha.slice(1)}</p>
    </div>
  );
}

function IndicadorRed({ estado, latenciaMs }) {
  const { etiqueta, color } = ESTADO_RED[estado];
  const latente = estado === "verificando";
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3">
      <span aria-hidden className="relative mt-1.5 flex h-2 w-2 shrink-0">
        {estado === "estable" && (
          <span
            className="absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping [animation-duration:2.4s]"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-[#E6E9EE]">{etiqueta}</p>
        <p className="mt-0.5 text-xs tabular-nums text-[#7D8BA0]">
          {latente || latenciaMs == null ? "Midiendo respuesta del servidor" : `Respuesta en ${latenciaMs} ms`}
        </p>
      </div>
    </div>
  );
}

function EnlaceSeccion({ href, children, cuenta }) {
  return (
    <a
      href={href}
      className={`flex h-9 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-[#A3AEBD] transition-colors duration-200 hover:bg-[#12284A]/60 hover:text-[#E6E9EE] ${FOCO}`}
    >
      {children}
      {cuenta != null && <span className="tabular-nums text-[#7D8BA0]">{cuenta}</span>}
    </a>
  );
}

export default function ControlSidebar({ usuario, red, conteos, onCerrarSesion, cerrandoSesion, errorCierre }) {
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-5 px-5 py-4 lg:px-8 xl:h-full xl:flex-col xl:flex-nowrap xl:items-stretch xl:gap-10 xl:px-5 xl:py-8">
      {/* Identidad */}
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#243B5A]">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#E6E9EE]" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-[#E6E9EE]">Astra Health</p>
          <p className="truncate text-xs text-[#7D8BA0]">Clínica Echeverría</p>
        </div>
      </div>

      <RelojClinica />

      <nav aria-label="Secciones del panel" className="-mx-3 hidden flex-col gap-0.5 xl:flex">
        <EnlaceSeccion href="#derivaciones" cuenta={conteos.derivaciones}>
          Derivaciones
        </EnlaceSeccion>
        <EnlaceSeccion href="#proximas-citas" cuenta={conteos.citasRestantes}>
          Próximas citas
        </EnlaceSeccion>
      </nav>

      <div className="flex w-full flex-wrap items-center gap-x-8 gap-y-4 sm:ml-auto sm:w-auto xl:mt-auto xl:block xl:w-full xl:space-y-6 xl:border-t xl:border-[#1A2D48] xl:pt-6">
        <IndicadorRed estado={red.estado} latenciaMs={red.latenciaMs} />

        {usuario && (
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm text-[#E6E9EE]">{usuario.nombre}</p>
            <p className="mt-0.5 text-xs text-[#7D8BA0]">{ROL[usuario.rol] ?? usuario.rol}</p>
          </div>
        )}

        <div className="ml-auto sm:ml-0">
          <button
            type="button"
            onClick={onCerrarSesion}
            disabled={cerrandoSesion}
            aria-busy={cerrandoSesion}
            className={`inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-[#243B5A] px-4 text-sm text-[#E6E9EE] transition-[background-color,border-color,transform] duration-200 hover:border-[#3A4F6E] hover:bg-[#12284A]/60 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100 ${FOCO}`}
          >
            {cerrandoSesion ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
            ) : (
              <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            )}
            {cerrandoSesion ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
          {errorCierre && (
            <p role="alert" className="mt-2 text-xs leading-snug text-[#E8A9A9]">
              {errorCierre}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
