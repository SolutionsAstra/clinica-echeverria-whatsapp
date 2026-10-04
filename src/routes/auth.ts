// src/api/auth.ts (frontend React)
// Contrato real del backend (src/routes/auth.routes.ts):
//   POST /api/auth/login  → 200 { ok: true, usuario } | 400/401 { error } | 500 { error }
//   POST /api/auth/logout → 200 { ok: true }
//   GET  /api/auth/me     → 200 usuario | 401 { error }

export type RolUsuario = "recepcion" | "doctor" | "direccion";

export interface UsuarioSesion {
  id: number;
  nombre: string;
  email: string;
  rol: RolUsuario;
  doctor_id: number | null;
}

// SIEMPRE ruta absoluta desde la raíz ("/api/..."). Una ruta relativa ("api/auth/login")
// desde una página en /admin/ se resuelve a /admin/api/auth/login → 404.
const AUTH = "/api/auth";

async function leerJson(res: Response): Promise<any> {
  // Un 404 de Vite o de Express llega vacío o en HTML: no reventar en .json().
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<UsuarioSesion> {
  const res = await fetch(`${AUTH}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // sin esto express.json() deja body vacío → 400
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });
  const data = await leerJson(res);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `No se pudo iniciar sesión (código ${res.status})`);
  }
  return data.usuario as UsuarioSesion;
}

export async function logout(): Promise<void> {
  await fetch(`${AUTH}/logout`, { method: "POST", credentials: "same-origin" });
}

export async function me(): Promise<UsuarioSesion | null> {
  const res = await fetch(`${AUTH}/me`, { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`No se pudo verificar la sesión (código ${res.status})`);
  return (await res.json()) as UsuarioSesion; // /me devuelve el usuario plano, sin envoltorio
}
