// Carga .env desde la RAÍZ del proyecto, sin depender de la carpeta desde donde se lance node
// (terminal, launch.json de VS Code, npm scripts o dist/). __dirname = src/ en desarrollo y dist/ compilado.
// Debe seguir siendo lo PRIMERO del archivo: whatsapp.js y los clientes de integrations/ leen
// process.env al hacer require.
const path = require('path');
const RUTA_ENV = path.resolve(__dirname, '..', '.env');
const dotenvResultado = require('dotenv').config({ path: RUTA_ENV });
if (dotenvResultado.error) {
  console.warn(`[server] No se encontró ${RUTA_ENV}; se usarán solo las variables del entorno del sistema.`);
}
const express = require('express');
const session = require('express-session');
const webhookRoutes = require('./routes/webhook');
const { authRouter } = require('./routes/auth.routes');
const adminApiRoutes = require('./routes/adminApi');
const { requireLogin, requireRole } = require('./middleware/auth');
const { getPool } = require('./db');
const wa = require('./whatsapp');
const { createVetModule, requireApiKey } = require('./modules/vet');
const { createDerivacionesModule } = require('./modules/derivaciones');
const { createPlanModule } = require('./modules/plan');
const { citaManualRouter } = require('./routes/citaManual.routes');
const dbSchema = process.env.DB_SCHEMA || 'public';
const { createImpactoIaModule, parsearTarifas } = require('./modules/impacto-ia');
const { estadoHorario } = require('./horarioLaboral');
// ---------------------------------------------------------------------------
// Adaptador del puerto Notifier (src/modules/derivaciones/application/ports.ts)
//
// El puerto exige:  enviarTexto(to: string, texto: string): Promise<unknown>
// y que la promesa RECHACE si Meta no entregó el mensaje (así la derivación guarda
// notificacion_error en vez de marcarse como notificada).
//
// Puente exacto con ./whatsapp:
//   notifier.enviarTexto(to, texto)  →  wa.enviarTextoEstricto(to, texto)   ← lanza si Meta falla
//
// wa.enviarTexto tiene la misma firma pero se traga los errores (la usa engine.js para no cortar
// la conversación). Si en otra rama el cliente se llama distinto (enviarMensaje, sendText…),
// agrégalo a CANDIDATOS SOLO si su firma es (to, texto). El adaptador falla AL ARRANCAR con un
// mensaje claro en lugar de reventar en la primera reserva.
// ---------------------------------------------------------------------------
function crearNotifierWhatsApp(cliente) {
  const CANDIDATOS = ['enviarTextoEstricto', 'enviarTexto', 'enviarMensaje'];
  const nombre = CANDIDATOS.find((n) => typeof (cliente && cliente[n]) === 'function');
  if (!nombre) {
    throw new Error(`[server] ./whatsapp no exporta ninguna función de envío compatible (${CANDIDATOS.join(', ')})`);
  }
  if (nombre !== 'enviarTextoEstricto') {
    console.warn(`[server] Notifier usando wa.${nombre}: si no lanza al fallar, las derivaciones se marcarán como notificadas aunque Meta rechace el envío.`);
  }
  const enviar = cliente[nombre].bind(cliente);
  return Object.freeze({ enviarTexto: (to, texto) => enviar(to, texto) });
}
const notificadorWhatsApp = crearNotifierWhatsApp(wa);

// Una sola instancia del middleware de API key: valida la clave una vez al arrancar.
// ---------------------------------------------------------------------------
// Clave servicio-a-servicio del Asistente de WhatsApp (header x-api-key).
// Se valida AL ARRANCAR: el servidor no debe levantar con las rutas de IA abiertas o con una clave
// débil. Este bloque solo cambia el mensaje de error, que ahora indica la causa exacta.
// ---------------------------------------------------------------------------
const LARGO_MINIMO_API_KEY = 24; // mismo mínimo que src/modules/vet/http/api-key.middleware.ts

function leerApiKeyIa() {
  const valor = process.env.VET_API_KEY;
  // Los espacios al inicio o al final se rechazan: HTTP los recorta del header, la comparación
  // fallaría siempre y el asistente recibiría 401 sin una causa visible.
  if (typeof valor === 'string' && valor.length >= LARGO_MINIMO_API_KEY && valor === valor.trim()) {
    return valor;
  }

  let causa;
  if (valor === undefined) causa = 'la variable no existe en el entorno';
  else if (valor.length === 0) causa = 'la variable existe pero está VACÍA (¿hay otra línea "VET_API_KEY=" más abajo en .env, o la define vacía la terminal o launch.json?)';
  else if (valor !== valor.trim()) causa = 'tiene espacios o saltos de línea al inicio o al final';
  else causa = `tiene solo ${valor.length} caracteres`;

  throw new Error([
    `[server] VET_API_KEY inválida: ${causa}. Se requieren al menos ${LARGO_MINIMO_API_KEY} caracteres.`,
    `  Archivo .env esperado: ${RUTA_ENV}${dotenvResultado.error ? '  ← NO ENCONTRADO' : ''}`,
    `  Genera una clave con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  ].join('\n'));
}

// Una sola instancia del middleware para todas las rutas del asistente.
const iaApiKey = requireApiKey(leerApiKeyIa());

const vetModule = createVetModule({ getPool, schema: dbSchema });
const derivacionesModule = createDerivacionesModule({
  getPool,
  schema: dbSchema,
  scheduler: vetModule.scheduler,      // reserva en proceso, sin HTTP
  notifier: notificadorWhatsApp,       // → wa.enviarTextoEstricto(to, texto)
  authorize: requireRole('recepcion', 'direccion'),
});
// Plan comercial de Astra: módulos premium, pruebas de 3 días y tope de operadores.
const planModule = createPlanModule({
  getPool,
  schema: dbSchema,
  authorizeIniciarPrueba: requireRole('direccion'),
});
// Tarjeta "Impacto del Agendamiento con IA" (Dirección).
const { tarifas: tarifasConsulta, avisos: avisosTarifas } = parsearTarifas(
  process.env.TARIFAS_CONSULTA,
  process.env.MONEDA_TARIFAS,
);
avisosTarifas.forEach((a) => console.warn('[impacto-ia]', a));
const impactoIaModule = createImpactoIaModule({
  getPool,
  schema: dbSchema,
  pruebaAgendamiento: () => planModule.service.pruebaDe('agendamiento_ia'),
  estadoModulo: async () => {
    const m = (await planModule.service.estado()).modulos.agendamiento_ia;
    return { habilitado: m.habilitado, origen: m.origen, pruebaExpiraEn: m.pruebaExpiraEn };
  },
  // Métricas premium de Reportes: solo con el módulo contratado o en prueba (lo decide el servidor).
  reportesHabilitado: async () => (await planModule.service.estado()).modulos.reportes.habilitado,
  tarifas: tarifasConsulta,
  // Misma regla horaria que el bot (America/Caracas + FERIADOS): una sola fuente de verdad.
  esFueraDeHorario: (fecha) => !estadoHorario(fecha).dentroDeHorario,
});
// Falla al arrancar con un mensaje claro si algún router no se resolvió.
for (const [nombre, mw] of Object.entries({
  authRouter,
  requireLogin,
  'vetModule.router': vetModule.router,
  'derivacionesModule.router': derivacionesModule.router,
  'derivacionesModule.iaRouter': derivacionesModule.iaRouter,
  'planModule.router': planModule.router,
  'planModule.capacidadesIaRouter': planModule.capacidadesIaRouter,
  'impactoIaModule.router': impactoIaModule.router,
})) {
  if (typeof mw !== 'function') throw new Error(`[server] ${nombre} no es un middleware (recibido: ${typeof mw})`);
}
require('./jobs/reminders');
require('./jobs/reportJob');

const app = express();
app.use(express.json());
app.locals.plan = planModule; // lo usa routes/adminApi.js para los bloqueos premium

app.use(session({
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // requiere HTTPS en producción
    maxAge: 8 * 3600000, // 8 horas
  },
  // Nota: el store por defecto es en memoria — para producción con más de una
  // instancia del servidor, usa connect-redis u otro store compartido.
}));

app.get('/', (req, res) => res.send('Servidor de WhatsApp — Clínica Echeverría activo ✅'));

// El webhook de Meta NO lleva autenticación (Meta no puede loguearse)
app.use('/webhook', webhookRoutes);

// Login/logout — públicos, es lo que permite entrar
app.use('/api/auth', authRouter);

// ── RUTAS DEL ASISTENTE DE WHATSAPP: x-api-key, sin sesión ─────────────────────────────
// DEBEN ir antes de app.use('/api', requireLogin, ...) o el asistente recibe 401.
// Todas usan la MISMA instancia iaApiKey.
app.use('/api/ia/capacidades', iaApiKey, planModule.capacidadesIaRouter);
app.use('/api/ia/derivaciones', iaApiKey, derivacionesModule.iaRouter);
// Agendamiento automático = módulo premium (contrato o prueba de 7 días vigente).
// Sin el módulo, POST /api/vet/citas responde 403 { error: 'MODULO_PREMIUM' } aunque el bot lo intente.
// GET /api/vet/disponibilidad queda abierto porque el modo derivación también lo usa.
app.post('/api/vet/citas', iaApiKey, planModule.requireModulo('agendamiento_ia'));
app.use('/api/vet', iaApiKey, vetModule.router);

// ── RUTAS DEL PANEL: sesión de Express + rol ───────────────────────────────────────────
// Bandeja: GET /api/derivaciones · POST /api/derivaciones/:id/reservar
//   → 201 | 409 SLOT_TAKEN | 409 DERIVACION_NO_DISPONIBLE | 422 | 503
app.use('/api/derivaciones', requireLogin, derivacionesModule.router);
// Estado del plan (candados premium); POST /api/plan/pruebas activa la prueba gratuita.
app.use('/api/plan', requireLogin, planModule.router);
// Cita manual desde el calendario: mismo motor de reservas, sin x-api-key en el navegador.
app.use(
  '/api/citas/manual',
  requireLogin,
  requireRole('recepcion', 'direccion'),
  citaManualRouter({ scheduler: vetModule.scheduler, notifier: notificadorWhatsApp })
);
// Métrica comercial: solo Dirección. Solo conteos, sin datos de pacientes.
app.use('/api/impacto-ia', requireLogin, requireRole('direccion'), impactoIaModule.router);

// Catch-all del panel: SIEMPRE al final de las rutas /api.
app.use('/api', requireLogin, adminApiRoutes);

// Panel estático (sin datos sensibles; la seguridad está en /api/*)
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

// Manejador de errores central — evita que un error de SQL tumbe el proceso
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Panel administrativo: http://localhost:${PORT}/admin`);
  console.log('URL del webhook a configurar en Meta: https://TU_DOMINIO_O_NGROK/webhook');
});