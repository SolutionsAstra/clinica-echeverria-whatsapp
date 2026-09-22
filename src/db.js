// db.js — capa de datos sobre SQL Server (antes era un archivo JSON).
// Todas las funciones son async ahora. Las firmas se mantuvieron lo más
// parecidas posible a la versión anterior para minimizar cambios en
// engine.js, availability.js y los jobs.

const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: {
    encrypt: process.env.DB_ENCRYPT !== 'false',        // true para Azure SQL / conexiones remotas
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' // true típicamente en desarrollo local
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch(err => {
      // Si la conexión falla, limpiamos la promesa cacheada para que el
      // siguiente intento vuelva a conectar (ej. la DB estuvo caída un momento)
      // en vez de quedar "envenenado" repitiendo el mismo error para siempre.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

async function query(strings, ...params) {
  const pool = await getPool();
  const req = pool.request();
  params.forEach((p, i) => req.input('p' + i, p));
  const text = strings.reduce((acc, s, i) => acc + s + (i < params.length ? `@p${i}` : ''), '');
  return req.query(text);
}

// ---------------- Especialidades ----------------
let _cacheEspecialidades = null;
async function getEspecialidades() {
  if (_cacheEspecialidades) return _cacheEspecialidades;
  const { recordset } = await query`SELECT id, codigo, nombre, duracion_min, requiere_recurso FROM especialidades`;
  _cacheEspecialidades = {};
  recordset.forEach(e => { _cacheEspecialidades[e.codigo] = e; });
  return _cacheEspecialidades;
}
async function getEspecialidadPorCodigo(codigo) {
  const esp = await getEspecialidades();
  return esp[codigo];
}

// ---------------- Doctores ----------------
async function getDoctores() {
  const { recordset } = await query`
    SELECT d.id, d.nombre, d.email, d.telefono,
           STRING_AGG(e.codigo, ',') AS especialidades_csv
    FROM doctores d
    LEFT JOIN doctor_especialidad de ON de.doctor_id = d.id
    LEFT JOIN especialidades e ON e.id = de.especialidad_id
    WHERE d.activo = 1
    GROUP BY d.id, d.nombre, d.email, d.telefono`;
  return recordset.map(d => ({ ...d, especialidades: (d.especialidades_csv || '').split(',').filter(Boolean) }));
}

async function getDoctorPrincipalDeEspecialidad(codigoEspecialidad) {
  // El doctor "por defecto" para agendar en esa especialidad (el primero configurado).
  const { recordset } = await query`
    SELECT TOP 1 d.id, d.nombre, d.email
    FROM doctores d
    JOIN doctor_especialidad de ON de.doctor_id = d.id
    JOIN especialidades e ON e.id = de.especialidad_id
    WHERE e.codigo = ${codigoEspecialidad} AND d.activo = 1
    ORDER BY d.id`;
  return recordset[0] || null;
}

async function getHorarioDoctor(doctorId) {
  const { recordset } = await query`SELECT TOP 1 * FROM horarios_disponibilidad WHERE doctor_id = ${doctorId}`;
  const h = recordset[0];
  if (!h) return null;
  return { ...h, dias: h.dias.split(',').map(Number) };
}

async function actualizarHorarioDoctor(doctorId, { dias, hora_inicio, hora_fin }) {
  const diasCsv = dias.join(',');
  const existente = await query`SELECT id FROM horarios_disponibilidad WHERE doctor_id = ${doctorId}`;
  if (existente.recordset.length) {
    await query`UPDATE horarios_disponibilidad SET dias = ${diasCsv}, hora_inicio = ${hora_inicio}, hora_fin = ${hora_fin} WHERE doctor_id = ${doctorId}`;
  } else {
    await query`INSERT INTO horarios_disponibilidad (doctor_id, dias, hora_inicio, hora_fin) VALUES (${doctorId}, ${diasCsv}, ${hora_inicio}, ${hora_fin})`;
  }
  return getHorarioDoctor(doctorId);
}

// ---------------- Recursos ----------------
async function getRecursoPorTipo(tipo) {
  const { recordset } = await query`SELECT TOP 1 * FROM recursos WHERE tipo = ${tipo}`;
  return recordset[0] || null;
}

// ---------------- Pacientes ----------------
async function upsertPaciente({ telefono, nombre, es_menor = false, nombre_acudiente = null, telefono_acudiente = null }) {
  const existente = await query`SELECT * FROM pacientes WHERE telefono = ${telefono}`;
  if (existente.recordset[0]) {
    await query`UPDATE pacientes SET nombre = ${nombre}, es_menor = ${es_menor ? 1 : 0},
                nombre_acudiente = ${nombre_acudiente}, telefono_acudiente = ${telefono_acudiente}
                WHERE telefono = ${telefono}`;
  } else {
    await query`INSERT INTO pacientes (telefono, nombre, es_menor, nombre_acudiente, telefono_acudiente)
                VALUES (${telefono}, ${nombre}, ${es_menor ? 1 : 0}, ${nombre_acudiente}, ${telefono_acudiente})`;
  }
  const { recordset } = await query`SELECT * FROM pacientes WHERE telefono = ${telefono}`;
  return recordset[0];
}

// ---------------- Citas ----------------

async function citasFuturasDelDoctorYRecurso(doctorId, recursoId, diasAdelante) {
  const hasta = new Date(); hasta.setDate(hasta.getDate() + diasAdelante);
  const porDoctor = await query`
    SELECT * FROM citas WHERE estado = 'confirmada' AND doctor_id = ${doctorId}
    AND fecha_hora_inicio <= ${hasta}`;
  let porRecurso = { recordset: [] };
  if (recursoId) {
    porRecurso = await query`
      SELECT * FROM citas WHERE estado = 'confirmada' AND recurso_id = ${recursoId}
      AND fecha_hora_inicio <= ${hasta}`;
  }
  return { citasDoctor: porDoctor.recordset, citasRecurso: porRecurso.recordset };
}

async function crearCita({ paciente_id, doctor_id, especialidad_codigo, recurso_id, fecha_hora_inicio, fecha_hora_fin, notas }) {
  const esp = await getEspecialidadPorCodigo(especialidad_codigo);
  const { recordset } = await query`
    INSERT INTO citas (paciente_id, doctor_id, especialidad_id, recurso_id, fecha_hora_inicio, fecha_hora_fin, notas, estado)
    OUTPUT INSERTED.*
    VALUES (${paciente_id}, ${doctor_id}, ${esp.id}, ${recurso_id}, ${fecha_hora_inicio}, ${fecha_hora_fin}, ${notas}, 'confirmada')`;
  return recordset[0];
}

async function citasFuturasPorTelefono(telefono) {
  const { recordset } = await query`
    SELECT c.*, e.codigo AS especialidad_codigo, e.nombre AS especialidad_nombre, d.nombre AS doctor_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN especialidades e ON e.id = c.especialidad_id
    JOIN doctores d ON d.id = c.doctor_id
    WHERE p.telefono = ${telefono} AND c.estado = 'confirmada' AND c.fecha_hora_inicio > SYSUTCDATETIME()
    ORDER BY c.fecha_hora_inicio`;
  return recordset;
}

async function cancelarCita(id) {
  await query`UPDATE citas SET estado = 'cancelada' WHERE id = ${id}`;
}
async function marcarNoShow(id) {
  await query`UPDATE citas SET estado = 'no_show' WHERE id = ${id}`;
}
async function reprogramarCita(id, nuevoInicio, nuevoFin) {
  await query`UPDATE citas SET fecha_hora_inicio = ${nuevoInicio}, fecha_hora_fin = ${nuevoFin},
              recordatorio_24h_enviado = 0, recordatorio_2h_enviado = 0 WHERE id = ${id}`;
}

async function listarCitas({ estado, doctorId, especialidadCodigo } = {}) {
  const { recordset } = await query`
    SELECT c.*, p.nombre AS paciente_nombre, p.telefono AS paciente_telefono,
           d.nombre AS doctor_nombre, e.codigo AS especialidad_codigo, e.nombre AS especialidad_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN doctores d ON d.id = c.doctor_id
    JOIN especialidades e ON e.id = c.especialidad_id
    ORDER BY c.fecha_hora_inicio`;
  let citas = recordset;
  if (estado) citas = citas.filter(c => c.estado === estado);
  if (doctorId) citas = citas.filter(c => String(c.doctor_id) === String(doctorId));
  if (especialidadCodigo) citas = citas.filter(c => c.especialidad_codigo === especialidadCodigo);
  return citas;
}

async function citasDeHoy() {
  const { recordset } = await query`
    SELECT c.*, e.codigo AS especialidad_codigo
    FROM citas c JOIN especialidades e ON e.id = c.especialidad_id
    WHERE CAST(c.fecha_hora_inicio AS DATE) = CAST(SYSUTCDATETIME() AS DATE) AND c.estado <> 'cancelada'`;
  return recordset;
}

async function citasParaRecordatorios() {
  const { recordset } = await query`
    SELECT c.*, e.codigo AS especialidad_codigo, p.telefono AS paciente_telefono, d.nombre AS doctor_nombre
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    JOIN doctores d ON d.id = c.doctor_id
    JOIN especialidades e ON e.id = c.especialidad_id
    WHERE c.estado = 'confirmada'
      AND (c.recordatorio_24h_enviado = 0 OR c.recordatorio_2h_enviado = 0)
      AND c.fecha_hora_inicio > SYSUTCDATETIME()`;
  return recordset;
}
async function marcarRecordatorioEnviado(citaId, tipo) {
  if (tipo === '24h') await query`UPDATE citas SET recordatorio_24h_enviado = 1 WHERE id = ${citaId}`;
  else await query`UPDATE citas SET recordatorio_2h_enviado = 1 WHERE id = ${citaId}`;
}

// ---------------- Reportes ----------------
async function registrarReporteEnviado(doctorId, estado) {
  await query`INSERT INTO reportes_enviados (doctor_id, estado_envio) VALUES (${doctorId}, ${estado})`;
}
async function listarReportes() {
  const { recordset } = await query`
    SELECT r.*, d.nombre AS doctor_nombre FROM reportes_enviados r
    JOIN doctores d ON d.id = r.doctor_id ORDER BY r.fecha_generacion DESC`;
  return recordset;
}

// ---------------- Escaladas ----------------
async function registrarEscalada(telefono, motivo) {
  await query`INSERT INTO conversaciones_escaladas (telefono, motivo) VALUES (${telefono}, ${motivo})`;
}
async function listarEscaladas() {
  const { recordset } = await query`SELECT * FROM conversaciones_escaladas ORDER BY fecha DESC`;
  return recordset;
}

// ---------------- Métricas ----------------
async function metricas(doctorId = null) {
  const { recordset } = doctorId
    ? await query`
        SELECT
          COUNT(*) AS total_citas,
          SUM(CASE WHEN estado='confirmada' THEN 1 ELSE 0 END) AS confirmadas,
          SUM(CASE WHEN estado='cancelada' THEN 1 ELSE 0 END) AS canceladas,
          SUM(CASE WHEN estado='no_show' THEN 1 ELSE 0 END) AS no_show
        FROM citas WHERE doctor_id = ${doctorId}`
    : await query`
        SELECT
          COUNT(*) AS total_citas,
          SUM(CASE WHEN estado='confirmada' THEN 1 ELSE 0 END) AS confirmadas,
          SUM(CASE WHEN estado='cancelada' THEN 1 ELSE 0 END) AS canceladas,
          SUM(CASE WHEN estado='no_show' THEN 1 ELSE 0 END) AS no_show
        FROM citas`;
  const { recordset: esc } = await query`SELECT COUNT(*) AS n FROM conversaciones_escaladas`;
  const m = recordset[0];
  return {
    total_citas: m.total_citas,
    confirmadas: m.confirmadas,
    canceladas: m.canceladas,
    no_show: m.no_show,
    tasa_no_show: m.total_citas ? Math.round((m.no_show / m.total_citas) * 100) : 0,
    conversaciones_escaladas: doctorId ? null : esc[0].n
  };
}

// ---------------- Usuarios (login del panel) ----------------
async function getUsuarioPorEmail(email) {
  const { recordset } = await query`
    SELECT id, nombre, email, password_hash, rol, doctor_id
    FROM usuarios WHERE email = ${email} AND activo = 1`;
  return recordset[0] || null;
}

async function listarUsuarios() {
  const { recordset } = await query`
    SELECT u.id, u.nombre, u.email, u.rol, u.doctor_id, u.activo, d.nombre AS doctor_nombre
    FROM usuarios u
    LEFT JOIN doctores d ON d.id = u.doctor_id
    ORDER BY u.nombre`;
  return recordset;
}

async function crearUsuario({ nombre, email, password_hash, rol, doctor_id }) {
  const { recordset } = await query`
    INSERT INTO usuarios (nombre, email, password_hash, rol, doctor_id)
    OUTPUT INSERTED.id
    VALUES (${nombre}, ${email}, ${password_hash}, ${rol}, ${doctor_id})`;
  return { id: recordset[0].id };
}

async function actualizarUsuario(id, { nombre, rol, doctor_id, activo }) {
  await query`
    UPDATE usuarios SET nombre = ${nombre}, rol = ${rol}, doctor_id = ${doctor_id}, activo = ${activo ? 1 : 0}
    WHERE id = ${id}`;
}

async function cambiarPasswordUsuario(id, password_hash) {
  await query`UPDATE usuarios SET password_hash = ${password_hash} WHERE id = ${id}`;
}

module.exports = {
  getPool, getEspecialidades, getEspecialidadPorCodigo, getDoctores, getDoctorPrincipalDeEspecialidad,
  getHorarioDoctor, actualizarHorarioDoctor, getRecursoPorTipo, upsertPaciente,
  citasFuturasDelDoctorYRecurso, crearCita, citasFuturasPorTelefono, cancelarCita, marcarNoShow,
  reprogramarCita, listarCitas, citasDeHoy, citasParaRecordatorios, marcarRecordatorioEnviado,
  registrarReporteEnviado, listarReportes, registrarEscalada, listarEscaladas, metricas,
  getUsuarioPorEmail, listarUsuarios, crearUsuario, actualizarUsuario, cambiarPasswordUsuario
};
