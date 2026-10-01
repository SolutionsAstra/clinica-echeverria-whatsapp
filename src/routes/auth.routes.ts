// routes/auth.routes.ts
// Login del panel por sesión (cookie). Reemplaza a routes/authRoutes.js con la misma API:
//   POST /api/auth/login   { email, password } → 200 { ok, usuario } | 400 | 401
//   POST /api/auth/logout  → 200 { ok }
//   GET  /api/auth/me      → 200 usuario | 401
// requireLogin / requireRole (middleware/auth.js) leen req.session.usuario sin cambios.

import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { getPool } from "../db";

export type RolUsuario = "recepcion" | "doctor" | "direccion";

/** Lo único que vive en la sesión: nunca el password_hash. */
export interface UsuarioSesion {
  id: number;
  nombre: string;
  email: string;
  rol: RolUsuario;
  doctor_id: number | null;
}

// Tipado de req.session.usuario para todo el proyecto TS.
declare module "express-session" {
  interface SessionData {
    usuario?: UsuarioSesion;
  }
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface FilaUsuario {
  id: number;
  nombre: string;
  email: string;
  password_hash: string;
  rol: string;
  doctor_id: number | null;
  activo: boolean;
}

const ROLES: readonly RolUsuario[] = ["recepcion", "doctor", "direccion"];
const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos";
const MAX_EMAIL = 160; // = usuarios.email
const MAX_PASSWORD = 256;

/**
 * Hash señuelo con el mismo costo que los reales (10, ver README). Si el correo no
 * existe, igual se ejecuta bcrypt.compare contra él: la respuesta tarda lo mismo
 * y el tiempo no revela qué correos están registrados.
 */
const HASH_SENUELO = bcrypt.hashSync("senuelo-anti-enumeracion", 10);

function esRol(valor: string): valor is RolUsuario {
  return (ROLES as readonly string[]).includes(valor);
}

/** Nuevo id de sesión tras autenticar: evita la fijación de sesión. */
function regenerarSesion(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve()));
  });
}

function guardarSesion(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err: unknown) => (err ? reject(err) : resolve()));
  });
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const body = (req.body ?? {}) as LoginBody;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Petición mal formada: 400 (no revela nada sobre cuentas existentes).
  if (!email || !password || email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
    res.status(400).json({ error: "Ingresa tu correo y contraseña" });
    return;
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<FilaUsuario>(
      `SELECT id, nombre, email, password_hash, rol, doctor_id, activo
       FROM usuarios
       WHERE lower(email) = $1
       LIMIT 1`,
      [email],
    );
    const usuario = rows[0];

    // Siempre se compara (contra el hash real o el señuelo) ANTES de decidir.
    const claveValida = await bcrypt.compare(password, usuario?.password_hash ?? HASH_SENUELO);

    // No existe, clave incorrecta o cuenta desactivada: misma respuesta y mismo tiempo.
    if (!usuario || !claveValida || !usuario.activo) {
      res.status(401).json({ error: MENSAJE_CREDENCIALES });
      return;
    }

    if (!esRol(usuario.rol)) {
      console.error(`[auth] Usuario ${usuario.id} con rol desconocido '${usuario.rol}'; acceso denegado`);
      res.status(401).json({ error: MENSAJE_CREDENCIALES });
      return;
    }

    const datosSesion: UsuarioSesion = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      doctor_id: usuario.doctor_id ?? null,
    };

    await regenerarSesion(req);
    req.session.usuario = datosSesion;
    await guardarSesion(req); // persistida antes de responder: el siguiente request ya pasa requireLogin

    res.json({ ok: true, usuario: datosSesion });
  } catch (err) {
    next(err); // manejador central de server.js → 500 genérico
  }
}

export function logout(req: Request, res: Response, next: NextFunction): void {
  req.session.destroy((err: unknown) => {
    if (err) {
      next(err);
      return;
    }
    res.clearCookie("connect.sid"); // nombre por defecto de express-session
    res.json({ ok: true });
  });
}

export function me(req: Request, res: Response): void {
  const usuario = req.session?.usuario;
  if (!usuario) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  res.json(usuario);
}

export const authRouter = Router();
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.get("/me", me);
