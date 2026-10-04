// frontend/src/api/panel.js
// Cliente del panel. Rutas reales de src/routes/auth.routes.ts, src/routes/adminApi.js y src/modules/plan.
// Solo cookie de sesión: ni x-api-key ni WHATSAPP_TOKEN pasan por el navegador.
import { pedir } from "./derivaciones";

const json = (body) => JSON.stringify(body);
const sinCache = { cache: "no-store" };

/* ---------------- Sesión ---------------- */

/** GET /api/auth/me → { id, nombre, rol, ... }. También sirve de latido de red. */
export const obtenerSesion = ({ signal } = {}) => pedir("/api/auth/me", { signal, ...sinCache });

export const cerrarSesion = () => pedir("/api/auth/logout", { method: "POST" });

/* ---------------- Plan comercial (src/modules/plan) ---------------- */

/** GET /api/plan → { modulos: { [modulo]: { habilitado, origen, pruebaExpiraEn, pruebaDisponible } }, operadores, diasPrueba } */
export const obtenerPlan = ({ signal } = {}) => pedir("/api/plan", { signal, ...sinCache });

/** POST /api/plan/pruebas → 201 EstadoPlan | 409 PRUEBA_NO_DISPONIBLE. Solo dirección. */
export const iniciarPrueba = (modulo) => pedir("/api/plan/pruebas", { method: "POST", body: json({ modulo }) });

/* ---------------- Métricas ---------------- */

export const obtenerMetricas = ({ signal } = {}) => pedir("/api/metricas", { signal, ...sinCache });

/* ---------------- Citas ---------------- */

/**
 * GET /api/citas → CitaDetallada[] (src/db.ts → listarCitas):
 * { id, estado, doctor_id, fecha_hora_inicio, fecha_hora_fin, paciente_nombre, paciente_telefono,
 *   doctor_nombre, especialidad_codigo, especialidad_nombre, ... }
 * Sin filtros: el panel filtra en el cliente. Un doctor recibe solo su agenda (lo fuerza el servidor).
 */
export const listarCitas = ({ signal } = {}) => pedir("/api/citas", { signal, ...sinCache });

export const cancelarCita = (id) => pedir(`/api/citas/${encodeURIComponent(id)}/cancelar`, { method: "POST" });

export const marcarNoShow = (id) => pedir(`/api/citas/${encodeURIComponent(id)}/no-show`, { method: "POST" });

/** Premium (Notificaciones Avanzadas): 403 MODULO_PREMIUM mientras no esté activo. */
export const enviarRecordatorioManual = (id) =>
  pedir(`/api/citas/${encodeURIComponent(id)}/recordatorio-manual`, { method: "POST" });

/* ---------------- Doctores ---------------- */

/** GET /api/doctores → [{ id, nombre, email, especialidades: string[], horario: { dias, hora_inicio, hora_fin } }] */
export const listarDoctores = ({ signal } = {}) => pedir("/api/doctores", { signal, ...sinCache });

export const actualizarHorario = (doctorId, { dias, hora_inicio, hora_fin }) =>
  pedir(`/api/doctores/${encodeURIComponent(doctorId)}/horario`, { method: "PUT", body: json({ dias, hora_inicio, hora_fin }) });

/* ---------------- Reportes (premium, solo dirección) ---------------- */

export const listarReportes = ({ signal } = {}) => pedir("/api/reportes", { signal, ...sinCache });

export const generarReporteAhora = () => pedir("/api/reportes/generar-ahora", { method: "POST" });

/* ---------------- Escaladas ---------------- */

export const listarEscaladas = ({ signal } = {}) => pedir("/api/escaladas", { signal, ...sinCache });

/* ---------------- Usuarios (solo dirección) ---------------- */

export const listarUsuarios = ({ signal } = {}) => pedir("/api/usuarios", { signal, ...sinCache });

/** 403 LIMITE_OPERADORES cuando el plan ya tiene todos sus operadores activos. */
export const crearUsuario = ({ nombre, email, password, rol, doctor_id }) =>
  pedir("/api/usuarios", { method: "POST", body: json({ nombre, email, password, rol, doctor_id }) });

export const actualizarUsuario = (id, { nombre, rol, doctor_id, activo }) =>
  pedir(`/api/usuarios/${encodeURIComponent(id)}`, { method: "PUT", body: json({ nombre, rol, doctor_id, activo }) });

export const restablecerClave = (id, password) =>
  pedir(`/api/usuarios/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: json({ password }) });

/* ---------------- Errores ---------------- */

/**
 * pedir() deja el código en err.code y el texto en err.message. Las rutas nuevas responden
 * { error: CODIGO, mensaje }; las legadas, { error: 'Texto para la persona' }. Esto da siempre
 * un texto legible.
 */
export function textoDeError(err, respaldo = "No se pudo completar la acción. Revisa la conexión e intenta de nuevo.") {
  const mensaje = err?.message;
  if (mensaje && !/^HTTP \d+$/.test(mensaje) && mensaje !== "Failed to fetch") return mensaje;
  const codigo = err?.code;
  if (typeof codigo === "string" && /\s/.test(codigo)) return codigo; // mensaje legado en `error`
  return respaldo;
}
