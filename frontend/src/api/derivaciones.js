// frontend/src/api/derivaciones.js
// Cliente del panel. Solo usa la cookie de sesión: ni x-api-key ni WHATSAPP_TOKEN pasan por aquí.
// Si el frontend corre en otro puerto (Vite), configura un proxy de /api → :3000 para
// mantener el mismo origen y que la cookie viaje.

export const RUTA_LOGIN = "/admin/login.html";

/** Cuerpo de la respuesta como objeto; {} si viene vacío o no es JSON (proxy, página HTML). */
async function leerCuerpo(res) {
  const texto = await res.text();
  if (!texto) return {};
  try {
    const data = JSON.parse(texto);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** Rutas nuevas: { error: CODIGO }. Algunas capas usan `code` o `codigo`. Legadas: { error: 'Texto' }. */
function codigoDeError(data) {
  for (const clave of ["error", "code", "codigo"]) {
    const valor = data?.[clave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return "DEFAULT";
}

/**
 * fetch con sesión. Separa los tres tipos de fallo para que la interfaz no los confunda:
 *   - Sin respuesta (red caída, servidor apagado): err.status === undefined, err.code "SIN_CONEXION".
 *   - 401: redirige al login.
 *   - Respuesta con error (403, 409, 422…): err.status, err.code, err.modulo.
 * Un 403 MODULO_PREMIUM es una respuesta válida del servidor, nunca una caída de red.
 */
export async function pedir(url, opciones = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opciones,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err; // cancelada por useSondeo: no es un fallo
    throw Object.assign(new Error("No hay conexión con el servidor."), { code: "SIN_CONEXION", status: undefined, cause: err });
  }

  if (res.status === 401) {
    window.location.href = RUTA_LOGIN;
    throw Object.assign(new Error("No autenticado"), { code: "UNAUTHENTICATED", status: 401 });
  }

  const data = await leerCuerpo(res);
  if (!res.ok) {
    // `code` es lo que leen BandejaDerivaciones (leerCodigoError) y esBloqueoPremium().
    throw Object.assign(new Error(data.mensaje || data.message || `HTTP ${res.status}`), {
      code: codigoDeError(data),
      status: res.status,
      modulo: typeof data.modulo === "string" ? data.modulo : null,
    });
  }
  return data;
}

export const listarDerivaciones = ({ signal } = {}) => pedir("/api/derivaciones", { signal });

/** Firma compatible con la prop onReservar(payload, solicitud). Solo se envían inicio y doctorId. */
export const reservarDerivacion = ({ derivacionId, inicio, doctorId }) =>
  pedir(`/api/derivaciones/${encodeURIComponent(derivacionId)}/reservar`, {
    method: "POST",
    body: JSON.stringify({ inicio, doctorId }),
  });