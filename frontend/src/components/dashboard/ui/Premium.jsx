/**
 * Bloqueos comerciales de Astra Health.
 *   <PanelPremium>    pantalla de bloqueo de un módulo (vidrio esmerilado sobre una vista previa atenuada)
 *   <DialogoPremium>  la misma idea como diálogo modal
 *   <BotonBloqueado>  acción visible pero inactiva; el motivo aparece en un tooltip flotante
 * Solo presentación: el servidor responde 403 aunque alguien manipule la interfaz.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, X } from "lucide-react";
import { FOCO } from "../workspace/tokens";
import { BOTON_SECUNDARIO, TAMANO_COMPACTO } from "./estilos";

/** Enlace opcional a Soluciones Astra (VITE_ASTRA_CONTACTO=mailto:… o https://…). */
const CONTACTO_ASTRA = import.meta.env?.VITE_ASTRA_CONTACTO ?? null;
const ANCHO_TOOLTIP = 288; // w-72
const MARGEN = 8;

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

export function PanelPremium({ titulo, mensaje, vistaPrevia, children }) {
  const tituloId = useId();
  return (
    <section
      aria-labelledby={tituloId}
      className="relative isolate min-h-[30rem] overflow-hidden rounded-[10px] border border-[#1A2D48]"
    >
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
        if (e.target === e.currentTarget) onCerrar();
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
 * Tooltip montado en document.body con position: fixed. No lo recortan los paneles con scroll
 * ni las tarjetas de vidrio (backdrop-filter crea un bloque contenedor para `fixed`).
 */
function TooltipFlotante({ posicion, children }) {
  if (!posicion) return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[60] w-72 rounded-md border border-[#243B5A] bg-[#0E1F36] px-3 py-2.5 text-xs leading-relaxed text-[#E6E9EE] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)]"
      style={{
        top: posicion.top,
        left: posicion.left,
        transform: posicion.arriba ? "translateY(-100%)" : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

const TAMANO_ICONO = { normal: "h-4 w-4", compacto: "h-3.5 w-3.5", icono: "h-3.5 w-3.5", mini: "h-3 w-3" };

/**
 * Botón visible pero inactivo. Usa aria-disabled (no `disabled`) para seguir siendo enfocable:
 * el motivo aparece con el cursor, con el teclado y al tocarlo.
 * variante: "normal" (barra de acciones) | "compacto" (tarjeta) | "icono" (fila) | "mini" (calendario)
 */
export function BotonBloqueado({ etiqueta, motivo, Icono, variante = "normal", className = "" }) {
  const motivoId = useId();
  const boton = useRef(null);
  const [posicion, setPosicion] = useState(null);
  const conTexto = variante === "normal" || variante === "compacto";
  const tamanoIcono = TAMANO_ICONO[variante] ?? TAMANO_ICONO.normal;

  const mostrar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const arriba = window.innerHeight - r.bottom < 96;
    setPosicion({
      top: arriba ? r.top - MARGEN : r.bottom + MARGEN,
      left: Math.max(MARGEN, Math.min(r.right - ANCHO_TOOLTIP, window.innerWidth - ANCHO_TOOLTIP - MARGEN)),
      arriba,
    });
  }, []);
  const ocultar = useCallback(() => setPosicion(null), []);

  useEffect(() => {
    if (!posicion) return undefined;
    const alTecla = (e) => {
      if (e.key === "Escape") ocultar();
    };
    window.addEventListener("scroll", ocultar, true);
    window.addEventListener("resize", ocultar);
    window.addEventListener("keydown", alTecla);
    return () => {
      window.removeEventListener("scroll", ocultar, true);
      window.removeEventListener("resize", ocultar);
      window.removeEventListener("keydown", alTecla);
    };
  }, [posicion, ocultar]);

  return (
    <span className={`inline-flex ${className}`} onMouseEnter={mostrar} onMouseLeave={ocultar}>
      <button
        ref={boton}
        type="button"
        aria-disabled="true"
        aria-label={conTexto ? undefined : etiqueta}
        aria-describedby={motivoId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mostrar();
        }}
        onFocus={mostrar}
        onBlur={ocultar}
        className={`inline-flex cursor-not-allowed items-center rounded-md border border-dashed border-[#2A4266] bg-[#0B192C]/40 text-[#8A97A8] transition-colors duration-200 hover:border-[#3A4F6E] hover:text-[#A3AEBD] ${TAMANO_COMPACTO[variante] ?? TAMANO_COMPACTO.normal} ${FOCO}`}
      >
        {Icono && <Icono aria-hidden className={`${tamanoIcono} shrink-0`} strokeWidth={1.5} />}
        {conTexto && <span className={variante === "compacto" ? "min-w-0 flex-1" : ""}>{etiqueta}</span>}
        <Lock aria-hidden className={`${tamanoIcono} shrink-0 text-[#A3AEBD]`} strokeWidth={1.75} />
      </button>
      <span id={motivoId} className="sr-only">
        {motivo}
      </span>
      <TooltipFlotante posicion={posicion}>
        {!conTexto && <span className="mb-1 block font-medium text-[#F2F4F7]">{etiqueta}</span>}
        {motivo}
      </TooltipFlotante>
    </span>
  );
}