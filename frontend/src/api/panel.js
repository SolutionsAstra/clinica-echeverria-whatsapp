// frontend/src/api/panel.js
// Sesión y agenda del panel. Rutas reales de src/routes/authRoutes.js y src/routes/adminApi.js.
import { pedir } from "./derivaciones";

/** GET /api/auth/me → { id, nombre, rol, ... }. También sirve de latido de red. */
export const obtenerSesion = ({ signal } = {}) => pedir("/api/auth/me", { signal, cache: "no-store" });

export const cerrarSesion = () => pedir("/api/auth/logout", { method: "POST" });

/**
 * GET /api/citas?estado=confirmada → CitaDetallada[] (src/db.ts → listarCitas):
 * { id, estado, fecha_hora_inicio, fecha_hora_fin, paciente_nombre, paciente_telefono,
 *   doctor_nombre, especialidad_codigo, especialidad_nombre, ... }
 *
 * Ojo: el endpoint no filtra por fecha; el recorte a "hoy" se hace en el cliente.
 */
export const listarCitasConfirmadas = ({ signal } = {}) =>
  pedir("/api/citas?estado=confirmada", { signal, cache: "no-store" });
