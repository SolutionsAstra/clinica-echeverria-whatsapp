// frontend/src/api/derivaciones.js
// Cliente del panel. Solo usa la cookie de sesión: ni x-api-key ni WHATSAPP_TOKEN pasan por aquí.
// Si el frontend corre en otro puerto (Vite), configura un proxy de /api → :3000 para
// mantener el mismo origen y que la cookie viaje.

export const RUTA_LOGIN = "/admin/login.html";

export async function pedir(url, opciones = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opciones,
  });
  if (res.status === 401) {
    window.location.href = RUTA_LOGIN;
    throw Object.assign(new Error("No autenticado"), { code: "UNAUTHENTICATED" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `code` es lo que lee leerCodigoError() en BandejaDerivaciones.jsx
    throw Object.assign(new Error(data.mensaje || `HTTP ${res.status}`), { code: data.error ?? "DEFAULT", status: res.status });
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
