/**
 * Tokens del sistema "UI/UX Pro Max" (oxford + platino), los mismos de LoginForm y BandejaDerivaciones.
 *   fondo      #0B192C   superficie #0E1F36   línea #1A2D48   línea fuerte #243B5A
 *   platino    #E6E9EE   secundario #A3AEBD   apagado #7D8BA0
 *   verde quirúrgico #86D5BC (confirmado)   oro atenuado #C9AE72 (pendiente)
 */
export const FUENTE = "font-['Geist','Geist_Sans',ui-sans-serif,system-ui,sans-serif]";

export const FOCO =
  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#A3AEBD]";

/** Vidrio: translúcido pero con opacidad alta para mantener contraste AA sobre la red de partículas. */
export const VIDRIO = "border bg-[#0B192C]/75 backdrop-blur-md";
export const LINEA = "border-[#1A2D48]";

export const ESTADO_CONFIRMACION = {
  confirmado: { etiqueta: "Confirmado por WhatsApp", color: "#86D5BC" },
  pendiente: { etiqueta: "Pendiente de confirmación", color: "#C9AE72" },
};

export const ESTADO_RED = {
  estable: { etiqueta: "Conexión estable", color: "#86D5BC" },
  inestable: { etiqueta: "Conexión lenta", color: "#C9AE72" },
  verificando: { etiqueta: "Verificando conexión", color: "#7D8BA0" },
  sin_conexion: { etiqueta: "Sin conexión con el servidor", color: "#E8A9A9" },
};

export const COLOR_NEUTRO = "#7D8BA0";
