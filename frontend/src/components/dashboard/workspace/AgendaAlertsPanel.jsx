import { AlertTriangle, CalendarClock, CheckCheck, Clock3, RotateCw } from "lucide-react";
import { ESPECIALIDADES } from "../BandejaDerivaciones";
import { MAX_PROXIMAS_CITAS, ZONA_CLINICA } from "./agenda";
import { COLOR_NEUTRO, ESTADO_CONFIRMACION, FOCO, LINEA, VIDRIO } from "./tokens";

const fmtHora = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function cuandoEmpieza({ enCurso, minutosParaInicio }) {
  if (enCurso) return "En curso";
  if (minutosParaInicio < 1) return "Empieza ahora";
  if (minutosParaInicio < 60) return `En ${minutosParaInicio} min`;
  const h = Math.floor(minutosParaInicio / 60);
  const m = minutosParaInicio % 60;
  return m ? `En ${h} h ${m} min` : `En ${h} h`;
}

function TarjetaCita({ t }) {
  const esp = ESPECIALIDADES[t.especialidad];
  const color = esp?.color ?? COLOR_NEUTRO;
  const conf = ESTADO_CONFIRMACION[t.confirmacion];
  const IconoEstado = t.confirmacion === "confirmado" ? CheckCheck : Clock3;

  return (
    <li
      className={`relative rounded-md py-4 pl-5 pr-4 ${VIDRIO} ${t.urgente ? "border-[#4A4230]" : LINEA}`}
      aria-label={`${fmtHora.format(t.inicio)}, ${t.paciente}, ${esp?.nombre ?? t.especialidadNombre}, ${conf.etiqueta}`}
    >
      <span aria-hidden className="absolute inset-y-3 left-0 w-px" style={{ backgroundColor: color }} />

      <div className="flex items-baseline justify-between gap-3">
        <time dateTime={new Date(t.inicio).toISOString()} className="text-lg font-medium tabular-nums text-[#E6E9EE]">
          {fmtHora.format(t.inicio)}
        </time>
        <span className={`text-xs tabular-nums ${t.enCurso ? "text-[#E6E9EE]" : "text-[#7D8BA0]"}`}>
          {cuandoEmpieza(t)}
        </span>
      </div>

      <p className="mt-2 truncate text-sm font-medium text-[#E6E9EE]">{t.paciente}</p>
      <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[#A3AEBD]">
        <span className="shrink-0" style={{ color }}>
          {esp?.nombre ?? t.especialidadNombre}
        </span>
        <span aria-hidden className="h-3 w-px shrink-0 bg-[#243B5A]" />
        <span className="truncate">{t.doctor}</span>
      </p>

      <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: conf.color }}>
        <IconoEstado aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {conf.etiqueta}
      </p>

      {t.urgente && (
        <p className="mt-2 flex items-start gap-1.5 border-t border-[#1A2D48] pt-2 text-xs leading-snug text-[#C9AE72]">
          <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Empieza en menos de una hora y el paciente no ha confirmado. Conviene llamar.
        </p>
      )}
    </li>
  );
}

function Esqueleto() {
  return (
    <ul aria-hidden className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
      {Array.from({ length: MAX_PROXIMAS_CITAS }, (_, i) => (
        <li key={i} className={`h-[8.5rem] rounded-md ${VIDRIO} ${LINEA} motion-safe:animate-pulse`} />
      ))}
    </ul>
  );
}

export default function AgendaAlertsPanel({ tarjetas, restantesHoy, cargando, error, onReintentar }) {
  const sinDatos = tarjetas.length === 0;

  let resumen = "Citas confirmadas de hoy";
  if (!cargando && !error) {
    resumen =
      restantesHoy > tarjetas.length
        ? `Las ${tarjetas.length} más próximas de ${restantesHoy} que quedan hoy`
        : `${restantesHoy === 1 ? "Queda 1 cita" : `Quedan ${restantesHoy} citas`} hoy`;
  }

  return (
    <section aria-labelledby="proximas-citas-titulo" className="px-5 py-6 lg:px-8 2xl:px-5 2xl:py-8">
      <header className="mb-5">
        <h2 id="proximas-citas-titulo" className="text-base font-semibold tracking-tight text-[#E6E9EE]">
          Próximas citas
        </h2>
        <p className="mt-1 text-sm text-[#A3AEBD]">{resumen}</p>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-[#5A2E36] bg-[#1C1A2A]/80 px-3 py-3 text-sm text-[#E8A9A9]">
          <p>{sinDatos ? "No se pudo cargar la agenda de hoy." : "No se pudo actualizar la agenda. Mostrando la última lectura."}</p>
          <button
            type="button"
            onClick={onReintentar}
            className={`mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded text-[#E6E9EE] underline-offset-4 transition-colors duration-200 hover:underline ${FOCO}`}
          >
            <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reintentar
          </button>
        </div>
      )}

      {cargando && sinDatos ? (
        <Esqueleto />
      ) : sinDatos ? (
        !error && (
          <div className={`flex flex-col items-start rounded-md px-4 py-6 ${VIDRIO} ${LINEA}`}>
            <CalendarClock aria-hidden className="h-5 w-5 text-[#7D8BA0]" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-[#E6E9EE]">No quedan citas confirmadas hoy.</p>
            <p className="mt-1 text-sm text-[#A3AEBD]">Las que reserves desde la bandeja aparecerán aquí.</p>
          </div>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
          {tarjetas.map((t) => (
            <TarjetaCita key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
