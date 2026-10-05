/**
 * Clases base del sistema "UI/UX Pro Max" de Astra Health (oxford + platino).
 *   fondo #0B192C · superficie #0E1F36 · línea #1A2D48 · línea fuerte #243B5A
 *   platino #E6E9EE · cromado #A3AEBD · apagado #7D8BA0
 * Sin degradados ni resplandores: jerarquía con bordes de 1px, tono y espacio.
 */
import { FOCO } from "../workspace/tokens";

export const SUPERFICIE = "rounded-[10px] border border-[#1A2D48] bg-[#0E1F36]/90";

const BOTON =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 text-sm transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none";

export const BOTON_PRIMARIO = `${BOTON} border-[#E6E9EE] bg-[#E6E9EE] font-medium text-[#0B192C] hover:bg-white ${FOCO}`;
export const BOTON_SECUNDARIO = `${BOTON} border-[#243B5A] text-[#E6E9EE] hover:border-[#3A4F6E] hover:bg-[#12284A]/60 ${FOCO}`;
export const BOTON_FANTASMA = `${BOTON} h-8 border-transparent px-2.5 text-[#A3AEBD] hover:bg-[#12284A]/60 hover:text-[#E6E9EE] ${FOCO}`;
export const BOTON_PELIGRO = `${BOTON} h-8 border-[#5A2E33] px-3 text-[#F2B8B5] hover:bg-[#2A1519] ${FOCO}`;

export const CAMPO = `h-9 w-full rounded-md border border-[#1E3350] bg-[#0B192C] px-3 text-sm text-[#E6E9EE] placeholder:text-[#7D8BA0] transition-colors duration-200 hover:border-[#3A4F6E] disabled:cursor-not-allowed disabled:opacity-50 ${FOCO}`;
export const ETIQUETA = "mb-1.5 block text-xs text-[#A3AEBD]";

export const TABLA = "w-full min-w-[56rem] border-collapse text-left text-sm";
export const TH = "border-b border-[#1A2D48] px-5 py-3 text-xs font-normal text-[#7D8BA0]";
export const TD = "border-b border-[#1A2D48] px-5 py-3.5 align-middle text-[#E6E9EE]";
export const FILA = "transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-[#12284A]/40";
/** Tamaños de acciones compactas: barra de acciones, tarjeta, fila de tabla y bloque del calendario. */
export const TAMANO_COMPACTO = {
  normal: "h-9 gap-2 whitespace-nowrap px-4 text-sm",
  compacto: "min-h-7 w-full gap-1.5 px-2 py-1 text-left text-[11px] leading-tight",
  icono: "h-8 gap-1 px-2",
  mini: "h-5 gap-0.5 px-1",
};