import { RotateCw } from "lucide-react";
import { textoDeError } from "../../../api/panel";
import BandejaDerivaciones from "../BandejaDerivaciones";
import { ZONA_CLINICA } from "./agenda";
import { FOCO, LINEA, VIDRIO } from "./tokens";

const fmtHora = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const SIN_RESPUESTA = "El servidor no respondió. Revisa el indicador de conexión del menú y vuelve a intentarlo.";

/** Sin respuesta ≠ respuesta con error: un 403 o un 500 nunca se describen como caída de red. */
const explicar = (error) =>
  error?.status === undefined ? SIN_RESPUESTA : textoDeError(error, "El servidor rechazó la solicitud. Intenta de nuevo.");

function BotonReintentar({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-[#243B5A] px-3 text-sm text-[#E6E9EE] transition-[background-color,transform] duration-200 hover:bg-[#12284A]/60 active:scale-[0.98] ${FOCO}`}
    >
      <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      Reintentar
    </button>
  );
}

/**
 * Estados alrededor de <BandejaDerivaciones embebida />:
 * - primera carga: esqueleto
 * - error sin datos: mensaje según el tipo de fallo + reintentar
 * - error con datos: la bandeja sigue usable y se avisa que la lista puede estar desactualizada
 * (El 403 MODULO_PREMIUM lo intercepta DerivacionesView antes de llegar aquí.)
 */
export default function DerivacionesColumn({ solicitudes, cargando, error, actualizadoEn, onReintentar, onReservar }) {
  if (cargando && !solicitudes) {
    return (
      <div aria-busy="true" aria-label="Cargando derivaciones" className="px-5 py-8 lg:px-8 lg:py-10">
        <div className="h-7 w-56 rounded bg-[#12284A]/70 motion-safe:animate-pulse" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-[#12284A]/50 motion-safe:animate-pulse" />
        <div className={`mt-14 h-80 rounded-lg ${VIDRIO} ${LINEA} motion-safe:animate-pulse`} />
      </div>
    );
  }

  if (error && !solicitudes) {
    return (
      <div className="px-5 py-8 lg:px-8 lg:py-10">
        <h1 id="titulo-vista" tabIndex={-1} className="text-2xl font-semibold tracking-tight text-[#F2F4F7] outline-none">
          Derivaciones del agente IA
        </h1>
        <div role="alert" className={`mt-10 rounded-lg px-6 py-10 ${VIDRIO} ${LINEA}`}>
          <p className="text-sm font-medium text-[#E6E9EE]">
            {error.status === undefined ? "No se pudo cargar la bandeja." : "La bandeja no está disponible."}
          </p>
          <p className="mt-1 max-w-md text-sm text-[#A3AEBD]">{explicar(error)}</p>
          <div className="mt-5">
            <BotonReintentar onClick={onReintentar} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          role="status"
          className="mx-5 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#4A4230] bg-[#0B192C]/80 px-4 py-3 text-sm text-[#C9AE72] lg:mx-8"
        >
          <span>
            No se pudo actualizar la bandeja.
            {actualizadoEn ? ` Lista leída a las ${fmtHora.format(actualizadoEn)}.` : ""}
          </span>
          <BotonReintentar onClick={onReintentar} />
        </div>
      )}
      <BandejaDerivaciones solicitudes={solicitudes} onReservar={onReservar} embebida />
    </>
  );
}