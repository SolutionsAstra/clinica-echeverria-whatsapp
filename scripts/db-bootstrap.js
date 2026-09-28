#!/usr/bin/env node
// scripts/db-bootstrap.js — Inicializa y migra la BD de un consultorio SIN Docker ni sqlcmd.
// Usa el mismo driver `mssql` y las mismas variables DB_* que src/db.js.
//
//   node scripts/db-bootstrap.js --dry-run              muestra el plan, no escribe nada
//   node scripts/db-bootstrap.js --create-db            crea DB_NAME si no existe y aplica todo
//   node scripts/db-bootstrap.js --env .env.consultorio-norte   (multi-tenant)
//   node scripts/db-bootstrap.js --yes                  obligatorio para escribir en un servidor remoto
//
// Orden: sql/schema.sql -> sql/seed.sql -> sql/migrations/*.sql (orden alfabético).
// Cada archivo aplicado queda registrado en dbo.__astra_migraciones.
// Baseline: si la BD ya tiene las tablas/datos (ej. la base de tu socio), schema/seed se
// marcan como aplicados SIN ejecutarse, para no duplicar doctores ni usuarios.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const argv = parseArgs(process.argv.slice(2));
const envPath = path.resolve(process.cwd(), argv.env || '.env');
if (!fs.existsSync(envPath)) fail(`No encuentro el archivo de entorno: ${envPath}`);
require('dotenv').config({ path: envPath, override: true });

const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = process.env.DB_SCHEMA || 'dbo';
const TRACK = '[dbo].[__astra_migraciones]';
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '.', '(local)', os.hostname().toLowerCase()]);

if (!IDENT.test(SCHEMA)) fail(`DB_SCHEMA inválido: ${SCHEMA}`);

function config(database) {
  return {
    server: process.env.DB_SERVER,
    database,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 1433),
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    },
    // Una sola conexión: los SET de sesión de la migración (QUOTED_IDENTIFIER, XACT_ABORT)
    // se mantienen entre lotes, igual que con sqlcmd.
    pool: { max: 1, min: 0 },
    connectionTimeout: 15000,
    requestTimeout: 120000,
  };
}

function buildPlan() {
  const migDir = path.join(ROOT, 'sql', 'migrations');
  const migrations = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((f) => /^\d+.*\.sql$/i.test(f)).sort()
    : [];
  const tbl = `[${SCHEMA}].[doctores]`;
  return [
    {
      name: 'schema.sql',
      file: path.join(ROOT, 'sql', 'schema.sql'),
      baseline: `SELECT CASE WHEN OBJECT_ID(N'${tbl}', N'U') IS NULL THEN 0 ELSE 1 END AS v`,
    },
    {
      name: 'seed.sql',
      file: path.join(ROOT, 'sql', 'seed.sql'),
      baseline: `IF OBJECT_ID(N'${tbl}', N'U') IS NULL SELECT 0 AS v
                 ELSE EXEC(N'SELECT CASE WHEN EXISTS (SELECT 1 FROM ${tbl}) THEN 1 ELSE 0 END AS v')`,
    },
    ...migrations.map((f) => ({ name: `migrations/${f}`, file: path.join(migDir, f), baseline: null })),
  ];
}

async function main() {
  const server = process.env.DB_SERVER;
  const database = process.env.DB_NAME;
  if (!server || !database) fail(`Faltan DB_SERVER o DB_NAME en ${envPath}`);
  if (!IDENT.test(database)) fail(`DB_NAME inválido: ${database}`);
  const remote = !isLocal(server);

  log(`Destino: ${server}:${process.env.DB_PORT || 1433} / ${database}  ` +
      `(${remote ? 'REMOTO' : 'local'})  env=${path.basename(envPath)}${argv['dry-run'] ? '  [DRY-RUN]' : ''}`);

  if (argv['create-db']) {
    const exists = await ensureDatabase(database, remote);
    if (!exists) return; // dry-run sobre una base que aún no existe: no hay nada más que inspeccionar
  }

  const pool = await new sql.ConnectionPool(config(database)).connect();
  try {
    const applied = await readApplied(pool);
    const steps = [];

    for (const step of buildPlan()) {
      if (!fs.existsSync(step.file)) { warn(`No existe ${step.file}, se omite`); continue; }
      const text = readSql(step.file);
      const checksum = sha256(text);
      const prev = applied.get(step.name);

      if (prev) {
        if (prev !== checksum) warn(`${step.name} cambió desde que se aplicó. No se reejecuta; crea una migración nueva.`);
        steps.push({ ...step, action: 'skip' });
      } else if (step.baseline && (await scalar(pool, step.baseline)) === 1) {
        steps.push({ ...step, text, checksum, action: 'baseline' });
      } else {
        steps.push({ ...step, text, checksum, action: 'apply' });
      }
    }

    const label = { skip: 'ya aplicado ', baseline: 'baseline    ', apply: 'APLICAR     ' };
    log('Plan:');
    for (const s of steps) log(`  ${label[s.action]} ${s.name}`);

    const pending = steps.filter((s) => s.action === 'apply');
    if (argv['dry-run']) return log('Dry-run: no se escribió nada.');
    if (steps.every((s) => s.action === 'skip')) return log('La base ya está al día. ✔');
    if (remote && pending.length && !argv.yes) {
      fail(`Servidor REMOTO con ${pending.length} archivo(s) por aplicar. Haz BACKUP DATABASE primero ` +
           `y vuelve a correr con --yes.`);
    }

    await pool.request().batch(`
      IF OBJECT_ID(N'${TRACK}', N'U') IS NULL
        CREATE TABLE ${TRACK} (
          nombre      NVARCHAR(200) NOT NULL PRIMARY KEY,
          checksum    CHAR(64)      NOT NULL,
          modo        NVARCHAR(10)  NOT NULL,  -- aplicado | baseline
          aplicado_en DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
        );`);

    for (const s of steps) {
      if (s.action === 'skip') continue;
      if (s.action === 'baseline') {
        await record(pool.request(), s, 'baseline');
        log(`  ↳ ${s.name}: la base ya lo tenía, registrado como baseline`);
        continue;
      }
      const t0 = Date.now();
      await applyStep(pool, s);
      log(`  ✔ ${s.name} (${Date.now() - t0} ms)`);
    }
    log('Listo. ✔');
  } finally {
    await pool.close();
  }
}

async function applyStep(pool, step) {
  const batches = splitBatches(step.text);
  // Si el archivo maneja su propia transacción (ej. 001_modulo_vet.sql), no lo envolvemos.
  const ownTx = /^\s*BEGIN\s+TRAN(SACTION)?\b/im.test(step.text);

  if (ownTx) {
    for (let i = 0; i < batches.length; i++) await runBatch(pool.request(), batches[i], step.name, i);
    await record(pool.request(), step, 'aplicado');
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (let i = 0; i < batches.length; i++) await runBatch(new sql.Request(tx), batches[i], step.name, i);
    await record(new sql.Request(tx), step, 'aplicado');
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* la conexión pudo caerse; SQL Server revierte solo */ }
    throw err;
  }
}

async function runBatch(request, text, file, index) {
  try {
    await request.batch(text);
  } catch (err) {
    const line = err.lineNumber ? `, línea ${err.lineNumber} del lote` : '';
    err.message = `${file} — lote ${index + 1}${line}: ${err.message}`;
    throw err;
  }
}

function record(request, step, modo) {
  return request
    .input('n', sql.NVarChar(200), step.name)
    .input('c', sql.Char(64), step.checksum)
    .input('m', sql.NVarChar(10), modo)
    .query(`INSERT INTO ${TRACK} (nombre, checksum, modo) VALUES (@n, @c, @m)`);
}

async function readApplied(pool) {
  const { recordset } = await pool.request().query(`
    IF OBJECT_ID(N'${TRACK}', N'U') IS NULL
      SELECT CAST(NULL AS NVARCHAR(200)) AS nombre, CAST(NULL AS CHAR(64)) AS checksum WHERE 1 = 0
    ELSE
      EXEC(N'SELECT nombre, checksum FROM ${TRACK}')`);
  return new Map(recordset.map((r) => [r.nombre, r.checksum]));
}

async function ensureDatabase(name, remote) {
  if (remote && !argv.yes && !argv['dry-run']) fail('--create-db sobre un servidor remoto requiere --yes');
  const master = await new sql.ConnectionPool(config('master')).connect();
  try {
    const { recordset } = await master.request().input('n', sql.NVarChar(128), name).query('SELECT DB_ID(@n) AS id');
    if (recordset[0].id != null) return true;
    if (argv['dry-run']) { log(`[dry-run] Crearía la base ${name} y aplicaría todo el plan.`); return false; }
    await master.request().batch(`CREATE DATABASE [${name}]`);
    log(`  ✔ Base ${name} creada`);
    return true;
  } finally {
    await master.close();
  }
}

async function scalar(pool, query) {
  const { recordset } = await pool.request().query(query);
  return recordset[0] ? Number(recordset[0].v) : 0;
}

// Divide por líneas "GO" (con repetición opcional "GO 3"), igual que sqlcmd.
function splitBatches(text) {
  const out = [];
  let buf = [];
  for (const line of text.split('\n')) {
    const m = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line);
    if (!m) { buf.push(line); continue; }
    const batch = buf.join('\n').trim();
    if (batch) for (let i = 0; i < (Number(m[1]) || 1); i++) out.push(batch);
    buf = [];
  }
  const last = buf.join('\n').trim();
  if (last) out.push(last);
  return out;
}

function readSql(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function isLocal(server) { return LOCAL_HOSTS.has(server.split('\\')[0].toLowerCase()); }

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(list[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (list[i + 1] && !list[i + 1].startsWith('--')) out[m[1]] = list[++i];
    else out[m[1]] = true;
  }
  return out;
}

function hint(err) {
  const code = err.code || (err.originalError && err.originalError.code);
  if (code === 'ESOCKET' || code === 'ETIMEOUT') {
    return 'TCP/IP apagado, puerto distinto a DB_PORT, servicio detenido o firewall.\n' +
           '  Corre scripts\\win\\habilitar-sqlexpress.ps1 y verifica: Test-NetConnection localhost -Port 1433';
  }
  if (code === 'ELOGIN') return 'Usuario/clave incorrectos o la instancia sigue en modo "solo Windows" (ver paso de modo mixto).';
  if (/certificate|self.signed/i.test(err.message)) return 'En desarrollo local pon DB_TRUST_CERT=true en tu .env.';
  return null;
}

function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`⚠ ${msg}`); }
function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  const h = hint(err);
  if (h) console.error(`  Pista: ${h}`);
  process.exit(1);
});
