import { AlertCircle, CheckCircle2, RotateCw } from "lucide-react";
import { esBloqueoPremium } from "../plan/plan";
import { BloqueoPorRespuesta } from "../workspace/BloqueoPremium";
import { BOTON_SECUNDARIO, SUPERFICIE } from "./estilos";

/** Contenedor estándar de cada sección: mismo ancho máximo y ritmo de 8 px en todo el panel. */
export function ContenedorVista({ children, ancho = "max-w-[96rem]" }) {
  return <div className={`mx-auto w-full ${ancho} px-5 py-8 lg:px-8 lg:py-10`}>{children}</div>;
}

export function EncabezadoVista({ id, titulo, descripcion, children }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        <h1 id={id} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-[#F2F4F7] outline-none">
          {titulo}
        </h1>
        {descripcion && <p className="mt-2 text-sm leading-relaxed text-[#A3AEBD]">{descripcion}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

export function CargaVista({ filas = 5 }) {
  return (
    <div aria-busy="true" aria-label="Cargando" className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4">
          <div className="h-3.5 w-40 rounded bg-[#12284A]/70 motion-safe:animate-pulse" />
          <div className="h-3.5 w-24 rounded bg-[#12284A]/50 motion-safe:animate-pulse" />
          <div className="ml-auto h-3.5 w-16 rounded bg-[#12284A]/50 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * Explica el fallo según su tipo. Sin respuesta ≠ respuesta con error:
 * un 403 nunca se presenta como "el servidor no respondió".
 */
function explicarError(error) {
  const legible = error?.message && !/^HTTP \d+$/.test(error.message) ? error.message : null;
  if (!error || error.status === undefined) {
    return "El servidor no respondió. Revisa el indicador de conexión del menú y vuelve a intentarlo.";
  }
  if (error.status === 403) return legible ?? "Tu usuario no tiene acceso a esta sección.";
  if (error.status >= 500) return "El servidor tuvo un problema al responder. Intenta de nuevo en unos segundos.";
  return legible ?? "La solicitud no se pudo completar.";
}

/**
 * Último recurso de cada vista. Un 403 MODULO_PREMIUM es una respuesta comercial válida:
 * aquí se convierte en <BloqueoPremium> y jamás en "No se pudo cargar esta sección".
 */
export function ErrorVista({ titulo = "No se pudo cargar esta sección.", detalle, error, onReintentar, vistaPrevia }) {
  if (esBloqueoPremium(error)) {
    return <BloqueoPorRespuesta error={error} vistaPrevia={vistaPrevia} onActivada={onReintentar} />;
  }

  return (
    <div role="alert" className={`${SUPERFICIE} px-6 py-10`}>
      <p className="text-sm font-medium text-[#E6E9EE]">{titulo}</p>
      <p className="mt-1 max-w-md text-sm text-[#A3AEBD]">{detalle ?? explicarError(error)}</p>
      {onReintentar && (
        <button type="button" onClick={onReintentar} className={`${BOTON_SECUNDARIO} mt-5 h-8 px-3`}>
          <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Reintentar
        </button>
      )}
    </div>
  );
}

export function VacioVista({ titulo, children }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium text-[#E6E9EE]">{titulo}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-[#A3AEBD]">{children}</p>}
    </div>
  );
}

/** Resultado de una acción (crear, guardar, enviar). Vive junto a lo que lo produjo, no en un toast lejano. */
export function Resultado({ resultado }) {
  if (!resultado) return null;
  const ok = resultado.tipo === "ok";
  const Icono = ok ? CheckCircle2 : AlertCircle;
  return (
    <p role={ok ? "status" : "alert"} className={`flex items-start gap-2 text-sm ${ok ? "text-[#86D5BC]" : "text-[#F2A7A0]"}`}>
      <Icono aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      {resultado.texto}
    </p>
  );
}