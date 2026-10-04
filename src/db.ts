// db.ts — capa de datos sobre PostgreSQL (Supabase) con node-postgres.
// Reemplaza a db.js (mssql). Mantiene los mismos nombres y firmas de funciones
// para que engine.js, availability.js, los jobs, las rutas y el módulo VET
// sigan funcionando sin cambios.

import fs from "node:fs";
import path from "node:path";
import { Pool, types, type PoolConfig, type QueryResultRow } from "pg";
import { buildQuery } from "./lib/sql-template";

/** Huso de negocio: "hoy" siempre significa hoy en Caracas, no en UTC. */
const TZ_NEGOCIO = "America/Caracas";

// ---------------- Conversión de tipos ----------------
// DATE → 'YYYY-MM-DD' tal cual. Por defecto pg lo convierte a medianoche en la zona
// del proceso Node, lo que corre la fecha de nacimiento un día según el servidor.
types.setTypeParser(1082, (value: string) => value);
// INT8 (COUNT, SUM, bigserial) → number. Por defecto pg lo devuelve como string.
types.setTypeParser(20, (value: string) => Number(value));
// TIMESTAMPTZ ya llega como Date (instante UTC real): no requiere parser.

// ---------------- Tipos de filas ----------------
export interface Especialidad {
  id: number;
  codigo: string;
  nombre: string;
  duracion_min: number;
  requiere_recurso: boolean;
}

export interface Doctor {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  especialidades: string[];
}

export interface HorarioDoctor {
  id: number;
  doctor_id: number;
  dias: number[];
  hora_inicio: string;
  hora_fin: string;
}

export interface Recurso {
  id: number;
  nombre: string;
  tipo: string;
}

export interface Paciente {
  id: number;
  telefono: string;
  nombre: string;
  fecha_nacimiento: string | null;
  es_menor: boolean;
  nombre_acudiente: string | null;
  telefono_acudiente: string | null;
}

export type EstadoCita = "confirmada" | "cancelada" | "completada" | "no_show";

export interface Cita {
  id: number;
  paciente_id: number;
  doctor_id: number;
  especialidad_id: number;
  recurso_id: number | null;
  fecha_hora_inicio: Date;
  fecha_hora_fin: Date;
  estado: EstadoCita;
  notas: string | null;
  cita_relacionada_id: number | null;
  recordatorio_24h_enviado: boolean;
  recordatorio_2h_enviado: boolean;
  creado_en: Date;
}

export interface CitaDetallada extends Cita {
  paciente_nombre: string;
  paciente_telefono: string;
  doctor_nombre: string;
  especialidad_codigo: string;
  especialidad_nombre: string;
}

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  password_hash: string;
  rol: "recepcion" | "doctor" | "direccion";
  doctor_id: number | null;
}

// ---------------- Conexión ----------------
const HOST_DIRECTO_SUPABASE = /^db\.([a-z0-9]+)\.supabase\.co$/i;

function sslConfig(): PoolConfig["ssl"] {
  if (process.env.DB_SSL === "false") return false; // Postgres local sin TLS
  const caPath = process.env.DB_SSL_CA_PATH?.trim();
  if (caPath) {
    // Relativa a la raíz del proyecto (src/ y dist/ están un nivel abajo), no al cwd.
    const absoluta = path.isAbsolute(caPath) ? caPath : path.resolve(__dirname, "..", caPath);
    if (!fs.existsSync(absoluta)) {
      throw new Error(
        `[db] DB_SSL_CA_PATH apunta a ${absoluta}, que no existe. Descarga el certificado ` +
          "(Supabase → Database → SSL Configuration) a esa ruta, o quita la variable en desarrollo.",
      );
    }
    return { ca: fs.readFileSync(absoluta, "utf8"), rejectUnauthorized: true };
  }
  console.warn(
    "[db] DB_SSL_CA_PATH no está definido: la conexión va cifrada pero sin verificar el certificado del servidor. " +
      "Descarga el certificado de Supabase y define DB_SSL_CA_PATH antes de producción.",
  );
  return { rejectUnauthorized: false };
}

function normalizarConnectionString(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "[db] DATABASE_URL no es una URL válida. Si la contraseña contiene @ # / : ? %, codifícala con encodeURIComponent.",
    );
  }
  // pg da prioridad a los parámetros SSL de la URL sobre el objeto `ssl`: se quitan
  // para que mande sslConfig().
  for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(p);

  const directo = HOST_DIRECTO_SUPABASE.exec(url.hostname);
  if (directo) {
    console.warn(
      `[db] DATABASE_URL usa la conexión directa (${url.hostname}), que Supabase solo publica en IPv6. ` +
        `Si esta red no tiene IPv6 fallará con ENETUNREACH/ENOTFOUND. Usa el Session pooler: ` +
        `usuario postgres.${directo[1]} en aws-0-<region>.pooler.supabase.com:5432.`,
    );
  }
  return url.toString();
}

function pistaConexion(err: unknown): string | null {
  const e = (err ?? {}) as { code?: string; message?: string };
  if (/Tenant or user not found/i.test(e.message ?? "")) {
    return "El pooler no reconoce el usuario: debe ser postgres.<ref>, no solo postgres.";
  }
  switch (e.code) {
    case "ENETUNREACH":
    case "EHOSTUNREACH":
    case "ENOTFOUND":
      return "Sin ruta al host: casi siempre es db.<ref>.supabase.co (solo IPv6). Cambia DATABASE_URL al Session pooler.";
    case "ETIMEDOUT":
      return "Tiempo agotado: la red o un proxy bloquea la salida al puerto 5432 (prueba Test-NetConnection).";
    case "ECONNREFUSED":
      return "Conexión rechazada: revisa host y puerto de DATABASE_URL.";
    case "28P01":
      return "Usuario o contraseña incorrectos.";
    case "ENOENT":
      return "Falta un archivo local (normalmente el certificado de DB_SSL_CA_PATH).";
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "Certificado TLS no verificado: revisa DB_SSL_CA_PATH.";
    default:
      return null;
  }
}

function crearPool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("Falta DATABASE_URL (cadena de conexión de Supabase → Connect → Session pooler)");
  }
  const pool = new Pool({
    connectionString: normalizarConnectionString(raw),
    ssl: sslConfig(),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "clinica-echeverria-backend",
  });
  // Sin este listener, un cliente inactivo que pierde la conexión tumba el proceso.
  pool.on("error", (err: Error) => console.error("[db] Error en una conexión inactiva del pool:", err.message));
  return pool;
}

let poolPromise: Promise<Pool> | null = null;

/**
 * Pool perezoso y compartido (misma firma que en db.js): se crea y verifica en
 * la primera consulta. Si la conexión inicial falla, se descarta la promesa para
 * que el siguiente intento vuelva a conectar en vez de repetir el error para siempre.
 */
export function getPool(): Promise<Pool> {
  if (!poolPromise) {
    let pool: Pool;
    try {
      pool = crearPool();
    } catch (err) {
      const pista = pistaConexion(err);
      console.error("[db] No se pudo crear el pool:", (err as Error)?.message ?? err, pista ? `\n  Pista: ${pista}` : "");
      return Promise.reject(err);
    }
    poolPromise = pool
      .query("SELECT 1")
      .then(() => pool)
      .catch(async (err: unknown) => {
        poolPromise = null;
        const pista = pistaConexion(err);
        console.error("[db] Falló la conexión inicial:", (err as Error)?.message ?? err, pista ? `\n  Pista: ${pista}` : "");
        await pool.end().catch(() => undefined);
        throw err;
      });
  }
  return poolPromise;
}

/** Cierra el pool (apagado ordenado del servidor o scripts). */
export async function closePool(): Promise<void> {
  if (!poolPromise) return;
  const pending = poolPromise;
  poolPromise = null;
  const pool = await pending.catch(() => null);
  await pool?.end();
}

/** Consulta parametrizada con template literal: query`SELECT … WHERE id = ${id}`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T extends QueryResultRow = any>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const pool = await getPool();
  const { text, values: params } = buildQuery(strings, values);
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

function esViolacionUnique(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// ---------------- Especialidades ----------------
let cacheEspecialidades: Record<string, Especialidad> | null = null;

export async function getEspecialidades(): Promise<Record<string, Especialidad>> {
  if (cacheEspecialidades) return cacheEspecialidades;
  const rows = await query<Especialidad>`
    SELECT id, codigo, nombre, duracion_min, requiere_recurso FROM especialidades`;
  cacheEspecialidades = Object.fromEntries(rows.map((e) => [e.codigo, e]));
  return cacheEspecialidades;
}

export async function getEspecialidadPorCodigo(codigo: string): Promise<Especialidad | undefined> {
  const especialidades = await getEspecialidades();
  return especialidades[codigo];
}

// ---------------- Doctores ----------------
export async function getDoctores(): Promise<Doctor[]> {
  const rows = await query<Omit<Doctor, "especialidades"> & { especialidades_csv: string | null }>`
    SELECT d.id, d.nombre, d.email, d.telefono,
           STRING_AGG(e.codigo, ',' ORDER BY e.codigo) AS especialidades_csv
    FROM doctores d
    LEFT JOIN doctor_especialidad de ON de.doctor_id = d.id
    LEFT JOIN especialidades e ON e.id = de.especialidad_id
    WHERE d.activo
    GROUP BY d.id
    ORDER BY d.id`;
  return rows.map(({ especialidades_csv, ...d }) => ({
    ...d,
    especialidades: (especialidades_csv || "").split(",").filter(Boolean),
  }));
}

export async function getDoctorPrincipalDeEspecialidad(
  codigoEspecialidad: string,
): Promise<{ id: number; nombre: string; email: string } | null> {
  // El doctor "por defecto" para agendar en esa especialidad (el primero configurado).
  const rows = await query<{ id: number; nombre: string; email: string }>`
    SELECT d.id, d.nombre, d.email
    FROM doctores d
    JOIN doctor_especialidad de ON de.doctor_id = d.id
    JOIN especialidades e ON e.id = de.especialidad_id
    WHERE e.codigo = ${codigoEspecialidad} AND d.activo
    ORDER BY d.id
    LIMIT 1`;
  return rows[0] ?? null;
}

export async function getHorarioDoctor(doctorId: number): Promise<HorarioDoctor | null> {
  const rows = await query<Omit<HorarioDoctor, "dias"> & { dias: string }>`
    SELECT id, doctor_id, dias, hora_inicio, hora_fin
    FROM horarios_disponibilidad WHERE doctor_id = ${doctorId}
    ORDER BY id
    LIMIT 1`;
  const h = rows[0];
  if (!h) return null;
  return { ...h, dias: h.dias.split(",").map(Number) };
}

export async function actualizarHorarioDoctor(
  doctorId: number,
  { dias, hora_inicio, hora_fin }: { dias: number[]; hora_inicio: string; hora_fin: string },
): Promise<HorarioDoctor | null> {
  const diasCsv = dias.join(",");
  // Actualiza si existe, inserta si no — en una sola sentencia atómica.
  await query`
    WITH actualizado AS (
      UPDATE horarios_disponibilidad
      SET dias = ${diasCsv}, hora_inicio = ${hora_inicio}, hora_fin = ${hora_fin}
      WHERE doctor_id = ${doctorId}
      RETURNING id
    )
    INSERT INTO horarios_disponibilidad (doctor_id, dias, hora_inicio, hora_fin)
    SELECT ${doctorId}, ${diasCsv}, ${hora_inicio}, ${hora_fin}
    WHERE NOT EXISTS (SELECT 1 FROM actualizado)`;
  return getHorarioDoctor(doctorId);
}

// ---------------- Recursos ----------------
export async function getRecursoPorTipo(tipo: string): Promise<Recurso | null> {
  const rows = await query<Recurso>`SELECT id, nombre, tipo FROM recursos WHERE tipo = ${tipo} ORDER BY id LIMIT 1`;
  return rows[0] ?? null;
}

// ---------------- Pacientes ----------------
export async function upsertPaciente({
  telefono,
  nombre,
  es_menor = false,
  nombre_acudiente = null,
  telefono_acudiente = null,
}: {
  telefono: string;
  nombre: string;
  es_menor?: boolean;
  nombre_acudiente?: string | null;
  telefono_acudiente?: string | null;
}): Promise<Paciente> {
  const rows = await query<Paciente>`
    INSERT INTO pacientes (telefono, nombre, es_menor, nombre_acudiente, telefono_acudiente)
    VALUES (${telefono}, ${nombre}, ${Boolean(es_menor)}, ${nombre_acudiente}, ${telefono_acudiente})
    ON CONFLICT (telefono) DO UPDATE SET
      nombre             = EXCLUDED.nombre,
      es_menor           = EXCLUDED.es_menor,
      nombre_acudiente   = EXCLUDED.nombre_acudiente,
      telefono_acudiente = EXCLUDED.telefono_acudiente
    RETURNING *`;
  return rows[0];
}

// ---------------- Citas ----------------
export async function citasFuturasDelDoctorYRecurso(
  doctorId: number,
  recursoId: number | null,
  diasAdelante: number,
): Promise<{ citasDoctor: Cita[]; citasRecurso: Cita[] }> {
  const hasta = new Date(Date.now() + diasAdelante * 86_400_000);
  const citasDoctor = await query<Cita>`
    SELECT * FROM citas
    WHERE estado = 'confirmada' AND doctor_id = ${doctorId} AND fecha_hora_inicio <= ${hasta}`;
  const citasRecurso = recursoId
    ? await query<Cita>`
        SELECT * FROM citas
        WHERE estado = 'confirmada' AND recurso_id = ${recursoId} AND fecha_hora_inicio <= ${hasta}`
    : [];
  return { citasDoctor, citasRecurso };
}

export async function crearCita({
  paciente_id,
  doctor_id,
  especialidad_codigo,
  recurso_id,
  fecha_hora_inicio,
  fecha_hora_fin,
  notas,
}: {
  paciente_id: number;
  doctor_id: number;
  especialidad_codigo: string;
  recurso_id: number | null;
  fecha_hora_inicio: Date | string;
  fecha_hora_fin: Date | string;
  notas: string | null;
}): Promise<Cita> {
  const rows = await query<Cita>`
    INSERT INTO citas (paciente_id, doctor_id, especialidad_id, recurso_id, fecha_hora_inicio, fecha_hora_fin, notas, estado)
    SELECT ${paciente_id}, ${doctor_id}, e.id, ${recurso_id}, ${fecha_hora_inicio}, ${fecha_hora_fin}, ${notas}, 'confirmada'
    FROM especialidades e
    WHERE e.codigo = ${especialidad_codigo}
    RETURNING *`;
  if (!rows[0]) throw new Error(`La especialidad '${especialidad_codigo}' no existe`);
  return rows[0];
}

export async function citasFuturasPorTelefono(
  telefono: string,
): Promise<(Cita & { especialidad_codigo: string; especialidad_nombre: string; doctor_nombre: string })[]> {
  return query`
    SELECT c.*, e.codigo AS especialidad_codigo, e.nombre AS especialidad_nombre, d.nombre AS doctor_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN especialidades e ON e.id = c.especialidad_id
    JOIN doctores d ON d.id = c.doctor_id
    WHERE p.telefono = ${telefono} AND c.estado = 'confirmada' AND c.fecha_hora_inicio > NOW()
    ORDER BY c.fecha_hora_inicio`;
}

export async function cancelarCita(id: number): Promise<void> {
  await query`UPDATE citas SET estado = 'cancelada' WHERE id = ${id}`;
}

export async function marcarNoShow(id: number): Promise<void> {
  await query`UPDATE citas SET estado = 'no_show' WHERE id = ${id}`;
}

export async function reprogramarCita(id: number, nuevoInicio: Date | string, nuevoFin: Date | string): Promise<void> {
  await query`
    UPDATE citas
    SET fecha_hora_inicio = ${nuevoInicio}, fecha_hora_fin = ${nuevoFin},
        recordatorio_24h_enviado = FALSE, recordatorio_2h_enviado = FALSE
    WHERE id = ${id}`;
}

export async function listarCitas({
  estado,
  doctorId,
  especialidadCodigo,
}: { estado?: string; doctorId?: number | string | null; especialidadCodigo?: string } = {}): Promise<CitaDetallada[]> {
  // Los filtros se aplican en SQL (db.js traía toda la tabla y filtraba en memoria).
  let doctor: number | null = null;
  if (doctorId !== undefined && doctorId !== null && doctorId !== "") {
    doctor = Number(doctorId);
    if (!Number.isInteger(doctor)) return []; // igual que antes: un id inválido no coincide con nada
  }
  return query<CitaDetallada>`
    SELECT c.*, p.nombre AS paciente_nombre, p.telefono AS paciente_telefono,
           d.nombre AS doctor_nombre, e.codigo AS especialidad_codigo, e.nombre AS especialidad_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN doctores d ON d.id = c.doctor_id
    JOIN especialidades e ON e.id = c.especialidad_id
    WHERE (${estado || null}::text IS NULL OR c.estado = ${estado || null}::text)
      AND (${doctor}::int IS NULL OR c.doctor_id = ${doctor}::int)
      AND (${especialidadCodigo || null}::text IS NULL OR e.codigo = ${especialidadCodigo || null}::text)
    ORDER BY c.fecha_hora_inicio`;
}

export async function citasDeHoy(): Promise<(Cita & { especialidad_codigo: string })[]> {
  // "Hoy" en Caracas. db.js comparaba contra la fecha UTC: entre las 20:00 y las
  // 23:59 de Caracas ya tomaba las citas del día siguiente.
  return query`
    SELECT c.*, e.codigo AS especialidad_codigo
    FROM citas c
    JOIN especialidades e ON e.id = c.especialidad_id
    WHERE (c.fecha_hora_inicio AT TIME ZONE ${TZ_NEGOCIO})::date = (NOW() AT TIME ZONE ${TZ_NEGOCIO})::date
      AND c.estado <> 'cancelada'`;
}

export async function citasParaRecordatorios(): Promise<
  (Cita & { especialidad_codigo: string; paciente_telefono: string; doctor_nombre: string })[]
> {
  return query`
    SELECT c.*, e.codigo AS especialidad_codigo, p.telefono AS paciente_telefono, d.nombre AS doctor_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN doctores d ON d.id = c.doctor_id
    JOIN especialidades e ON e.id = c.especialidad_id
    WHERE c.estado = 'confirmada'
      AND NOT c.recordatorio_2h_enviado
      AND c.fecha_hora_inicio > NOW()`;
}

export async function marcarRecordatorioEnviado(citaId: number, tipo: "24h" | "2h"): Promise<void> {
  if (tipo === "24h") await query`UPDATE citas SET recordatorio_24h_enviado = TRUE WHERE id = ${citaId}`;
  else await query`UPDATE citas SET recordatorio_2h_enviado = TRUE WHERE id = ${citaId}`;
}

// ---------------- Reportes ----------------
export async function registrarReporteEnviado(doctorId: number, estado: "enviado" | "fallido"): Promise<void> {
  await query`INSERT INTO reportes_enviados (doctor_id, estado_envio) VALUES (${doctorId}, ${estado})`;
}

export async function listarReportes() {
  return query`
    SELECT r.*, d.nombre AS doctor_nombre
    FROM reportes_enviados r
    JOIN doctores d ON d.id = r.doctor_id
    ORDER BY r.fecha_generacion DESC`;
}

// ---------------- Escaladas ----------------
export async function registrarEscalada(telefono: string, motivo: string): Promise<void> {
  await query`INSERT INTO conversaciones_escaladas (telefono, motivo) VALUES (${telefono}, ${motivo})`;
}

export async function listarEscaladas() {
  return query`SELECT * FROM conversaciones_escaladas ORDER BY fecha DESC`;
}

// ---------------- Métricas ----------------
export async function metricas(doctorId: number | null = null) {
  // ::int explícito: COUNT devuelve bigint y el panel hace aritmética con estos valores.
  const [m] = await query<{ total_citas: number; confirmadas: number; canceladas: number; no_show: number }>`
    SELECT COUNT(*)::int                                          AS total_citas,
           COUNT(*) FILTER (WHERE estado = 'confirmada')::int   AS confirmadas,
           COUNT(*) FILTER (WHERE estado = 'cancelada')::int    AS canceladas,
           COUNT(*) FILTER (WHERE estado = 'no_show')::int      AS no_show
    FROM citas
    WHERE (${doctorId}::int IS NULL OR doctor_id = ${doctorId}::int)`;
  const [esc] = await query<{ n: number }>`SELECT COUNT(*)::int AS n FROM conversaciones_escaladas`;
  return {
    total_citas: m.total_citas,
    confirmadas: m.confirmadas,
    canceladas: m.canceladas,
    no_show: m.no_show,
    tasa_no_show: m.total_citas ? Math.round((m.no_show / m.total_citas) * 100) : 0,
    conversaciones_escaladas: doctorId ? null : esc.n,
  };
}

// ---------------- Usuarios (login del panel) ----------------
export async function getUsuarioPorEmail(email: string): Promise<Usuario | null> {
  const rows = await query<Usuario>`
    SELECT id, nombre, email, password_hash, rol, doctor_id
    FROM usuarios WHERE email = ${email} AND activo`;
  return rows[0] ?? null;
}

export async function listarUsuarios() {
  return query`
    SELECT u.id, u.nombre, u.email, u.rol, u.doctor_id, u.activo, d.nombre AS doctor_nombre
    FROM usuarios u
    LEFT JOIN doctores d ON d.id = u.doctor_id
    ORDER BY u.nombre`;
}

export async function crearUsuario({
  nombre,
  email,
  password_hash,
  rol,
  doctor_id,
}: {
  nombre: string;
  email: string;
  password_hash: string;
  rol: string;
  doctor_id: number | null;
}): Promise<{ id: number }> {
  try {
    const rows = await query<{ id: number }>`
      INSERT INTO usuarios (nombre, email, password_hash, rol, doctor_id)
      VALUES (${nombre}, ${email}, ${password_hash}, ${rol}, ${doctor_id})
      RETURNING id`;
    return { id: rows[0].id };
  } catch (err) {
    // adminApi.js detecta el correo duplicado buscando 'UNIQUE' en el mensaje
    // (así lo reportaba SQL Server). Postgres usa el código 23505 y otro texto.
    if (esViolacionUnique(err)) {
      throw Object.assign(new Error("UNIQUE: el correo ya está registrado"), { code: "23505", cause: err });
    }
    throw err;
  }
}

export async function actualizarUsuario(
  id: number,
  { nombre, rol, doctor_id, activo }: { nombre: string; rol: string; doctor_id: number | null; activo: boolean },
): Promise<void> {
  await query`
    UPDATE usuarios
    SET nombre = ${nombre}, rol = ${rol}, doctor_id = ${doctor_id}, activo = ${Boolean(activo)}
    WHERE id = ${id}`;
}

export async function cambiarPasswordUsuario(id: number, password_hash: string): Promise<void> {
  await query`UPDATE usuarios SET password_hash = ${password_hash} WHERE id = ${id}`;
}
