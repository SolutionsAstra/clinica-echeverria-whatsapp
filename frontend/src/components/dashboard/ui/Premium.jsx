/**
 * Bloqueos comerciales de Astra Health.
 *
 *   <PanelPremium>     pantalla de bloqueo de un módulo completo (vidrio sobre una vista previa atenuada)
 *   <DialogoPremium>   la misma idea, como diálogo modal, para una función dentro de una vista
 *   <BotonBloqueado>   acción visible pero inactiva, con el motivo en un tooltip accesible
 *
 * Son solo presentación: el servidor responde 403 MODULO_PREMIUM / LIMITE_OPERADORES aunque
 * alguien manipule la interfaz.
 */
import { useEffect, useId, useRef } from "react";
import { Lock, X } from "lucide-react";
import { FOCO } from "../workspace/tokens";
import { BOTON_SECUNDARIO } from "./estilos";

/** Enlace opcional a Soluciones Astra (VITE_ASTRA_CONTACTO=mailto:… o https://…). */
const CONTACTO_ASTRA = import.meta.env?.VITE_ASTRA_CONTACTO ?? null;

export function SelloCandado({ className = "" }) {
  return (
    <span
      aria-hidden
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#3A4F6E] text-[#E6E9EE] ${className}`}
    >
      <Lock className="h-4 w-4" strokeWidth={1.5} />
    </span>
  );
}

export function EnlaceAstra() {
  if (!CONTACTO_ASTRA) return null;
  return (
    <a href={CONTACTO_ASTRA} target="_blank" rel="noreferrer" className={BOTON_SECUNDARIO}>
      Contactar a Soluciones Astra
    </a>
  );
}

/**
 * @param {{ titulo: string, mensaje: string, vistaPrevia?: React.ReactNode, children?: React.ReactNode }} props
 *   children = acciones (p. ej. "Probar Gratis por 3 días")
 */
export function PanelPremium({ titulo, mensaje, vistaPrevia, children }) {
  const tituloId = useId();
  return (
    <section aria-labelledby={tituloId} className="relative isolate min-h-[30rem] overflow-hidden rounded-[10px] border border-[#1A2D48]">
      {/* Lo que el módulo ofrece, atenuado e inerte: muestra la forma, no datos. */}
      <div aria-hidden inert className="pointer-events-none select-none opacity-40 blur-[2px]">
        {vistaPrevia}
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-5">
        <div className="w-full max-w-lg rounded-xl border border-[#243B5A] bg-[#0E1F36]/85 p-8 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-10">
          <SelloCandado />
          <h2 id={tituloId} className="mt-6 text-lg font-semibold tracking-tight text-[#F2F4F7]">
            {titulo}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#C7CCD3]">{mensaje}</p>
          {children && <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/** Diálogo modal nativo (<dialog>): foco atrapado, Escape y fondo inerte sin librerías. */
export function DialogoPremium({ abierto, onCerrar, titulo, mensaje, children }) {
  const ref = useRef(null);
  const tituloId = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={tituloId}
      onClose={onCerrar}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar(); // clic en el fondo
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-[#243B5A] bg-[#0E1F36]/90 p-0 text-[#E6E9EE] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] backdrop:bg-[#060E1A]/70 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-8 backdrop-blur-xl sm:p-10">
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className={`absolute right-4 top-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#A3AEBD] transition-colors duration-200 hover:bg-[#12284A]/60 hover:text-[#E6E9EE] ${FOCO}`}
        >
          <X aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <SelloCandado />
        <h2 id={tituloId} className="mt-6 text-lg font-semibold tracking-tight text-[#F2F4F7]">
          {titulo}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[#C7CCD3]">{mensaje}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {children}
          <button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>
            Entendido
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Botón visible pero inactivo. Usa aria-disabled (no `disabled`) para que siga siendo enfocable:
 * así el motivo aparece también al llegar con el teclado, y no solo con el cursor.
 */
export function BotonBloqueado({ etiqueta, motivo, Icono, className = "" }) {
  const tooltipId = useId();
  return (
    <span className={`group relative inline-flex ${className}`}>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={tooltipId}
        onClick={(e) => e.preventDefault()}
        className={`inline-flex h-9 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-md border border-dashed border-[#2A4266] px-4 text-sm text-[#8A97A8] transition-colors duration-200 hover:border-[#3A4F6E] ${FOCO}`}
      >
        {Icono && <Icono aria-hidden className="h-4 w-4" strokeWidth={1.5} />}
        {etiqueta}
        <Lock aria-hidden className="h-3.5 w-3.5 text-[#A3AEBD]" strokeWidth={1.75} />
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        className="pointer-events-none invisible absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-[#243B5A] bg-[#0E1F36] px-3 py-2.5 text-xs leading-relaxed text-[#E6E9EE] opacity-0 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none"
      >
        {motivo}
      </span>
    </span>
  );
}
