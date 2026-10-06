require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
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
const { createImpactoIaModule } = require('./modules/impacto-ia');
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
const iaApiKey = requireApiKey(process.env.VET_API_KEY);

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
const impactoIaModule = createImpactoIaModule({
  getPool,
  schema: dbSchema,
  pruebaAgendamiento: () => planModule.service.pruebaDe('agendamiento_ia'),
  estadoModulo: async () => {
    const m = (await planModule.service.estado()).modulos.agendamiento_ia;
    return { habilitado: m.habilitado, origen: m.origen, pruebaExpiraEn: m.pruebaExpiraEn };
  },
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

// Servicios para el Asistente de WhatsApp: API key, sin sesión.
// DEBEN ir antes de cualquier app.use('/api', requireLogin, ...) o el asistente recibe 401.
app.use('/api/ia/derivaciones', iaApiKey, derivacionesModule.iaRouter);
// Agendamiento automático = módulo premium (contrato o prueba de 7 días vigente).
// La barrera vive en el servidor: sin el módulo, POST /api/vet/citas responde
// 403 { error: 'MODULO_PREMIUM', modulo: 'agendamiento_ia' } aunque el bot lo intente.
// GET /api/vet/disponibilidad queda abierto porque el modo derivación también lo usa.
// El panel (derivaciones y cita manual) reserva en proceso con vetModule.scheduler y no pasa por aquí.
app.post('/api/vet/citas', iaApiKey, planModule.requireModulo('agendamiento_ia'));
app.use('/api/vet', iaApiKey, vetModule.router);

// Bandeja de derivaciones del panel: sesión + rol (recepcion/direccion)
//   GET  /api/derivaciones
//   POST /api/derivaciones/:id/reservar  → 201 | 409 SLOT_TAKEN | 409 DERIVACION_NO_DISPONIBLE | 422 | 503
app.use('/api/ia/derivaciones', iaApiKey, derivacionesModule.iaRouter);
// Estado del plan para pintar candados en el panel; POST /pruebas activa la prueba de 3 días.
app.use('/api/plan', requireLogin, planModule.router);
// Servicios para el Asistente de WhatsApp: API key, sin sesión.
// DEBEN ir antes de cualquier app.use('/api', requireLogin, ...) o el asistente recibe 401.
app.use('/api/ia/capacidades', iaApiKey, planModule.capacidadesIaRouter);

// Cita manual desde el calendario del panel: mismo motor de reservas del asistente, sin x-api-key
// en el navegador, y confirmación por WhatsApp en caliente.
app.use(
  '/api/citas/manual',
  requireLogin,
  requireRole('recepcion', 'direccion'),
  citaManualRouter({ scheduler: vetModule.scheduler, notifier: notificadorWhatsApp })
);
// Métrica comercial: solo Dirección (decide la contratación). Solo conteos, sin datos de pacientes.
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