// scripts/reset-password.ts — Diagnostica por qué un usuario no puede entrar y,
// opcionalmente, le asigna una contraseña nueva. Usa el mismo getPool() que el servidor.
//
//   Solo diagnóstico:  npx tsx scripts/reset-password.ts recepcion@clinicaecheverria.com
//   Diagnóstico + clave nueva:
//                      npx tsx scripts/reset-password.ts recepcion@clinicaecheverria.com 'ClaveNueva123'
//
// En PowerShell usa comillas SIMPLES para la clave: con dobles, "$algo" se interpola.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool, closePool } from "../src/db";

const ROLES = ["recepcion", "doctor", "direccion"];

async function main(): Promise<void> {
  const [emailArg, nuevaClave] = process.argv.slice(2);
  if (!emailArg) {
    console.error("Uso: npx tsx scripts/reset-password.ts <email> [nueva-clave]");
    process.exitCode = 1;
    return;
  }
  const email = emailArg.trim().toLowerCase(); // igual que auth.routes.ts

  const pool = await getPool();
  const { rows } = await pool.query<{
    id: number;
    email: string;
    rol: string;
    activo: boolean;
    password_hash: string | null;
  }>("SELECT id, email, rol, activo, password_hash FROM usuarios WHERE lower(email) = $1", [email]);

  if (rows.length === 0) {
    const { rows: todos } = await pool.query<{ email: string }>("SELECT email FROM usuarios ORDER BY id LIMIT 20");
    console.error(`✖ No existe ${email} en la tabla usuarios de esta base.`);
    console.error(
      todos.length
        ? `  Correos que sí existen: ${todos.map((u) => u.email).join(", ")}`
        : "  La tabla usuarios está VACÍA: el seed no se cargó en este proyecto de Supabase.",
    );
    process.exitCode = 1;
    return;
  }

  const u = rows[0];
  const hash = u.password_hash ?? "";
  const problemas: string[] = [];
  if (!u.activo) problemas.push("activo = false (la cuenta está desactivada)");
  if (!ROLES.includes(u.rol)) problemas.push(`rol desconocido '${u.rol}'`);
  if (!/^\$2[aby]\$\d{2}\$/.test(hash)) problemas.push(`password_hash no parece bcrypt (empieza con '${hash.slice(0, 4)}')`);
  else if (hash.length !== 60) problemas.push(`password_hash mide ${hash.length} caracteres (bcrypt mide 60: está truncado)`);

  console.log(`Usuario ${u.id} <${u.email}> rol=${u.rol} activo=${u.activo} largo_hash=${hash.length}`);
  console.log(problemas.length ? `⚠ Problemas: ${problemas.join("; ")}` : "✔ Fila consistente: si falla, la contraseña escrita no coincide con el hash.");

  if (!nuevaClave) return;
  if (nuevaClave.length < 6) {
    console.error("✖ La contraseña debe tener al menos 6 caracteres (misma regla que el panel).");
    process.exitCode = 1;
    return;
  }
  const nuevoHash = await bcrypt.hash(nuevaClave, 10);
  await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [nuevoHash, u.id]);
  const ok = await bcrypt.compare(nuevaClave, nuevoHash);
  console.log(`✔ Contraseña actualizada (verificación: ${ok ? "OK" : "FALLÓ"}).`);
  if (!u.activo) console.log("  Ojo: la cuenta sigue desactivada; actívala desde el panel de dirección o con UPDATE usuarios SET activo = true.");
}

main()
  .catch((err) => {
    console.error("✖", (err as Error)?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
