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

// Una sola instancia del middleware de API key: valida la clave una vez al arrancar.
const iaApiKey = requireApiKey(process.env.VET_API_KEY);

const vetModule = createVetModule({ getPool, schema: dbSchema });
const derivacionesModule = createDerivacionesModule({
  getPool,
  schema: dbSchema,
  scheduler: vetModule.scheduler,                  // reserva en proceso, sin HTTP
  notifier: wa,                                    // usa wa.enviarTexto(to, texto)
  authorize: requireRole('recepcion', 'direccion'),
});
// Plan comercial de Astra: módulos premium, pruebas de 3 días y tope de operadores.
const planModule = createPlanModule({
  getPool,
  schema: dbSchema,
  authorizeIniciarPrueba: requireRole('direccion'),
});

// Falla al arrancar con un mensaje claro si algún router no se resolvió.
for (const [nombre, mw] of Object.entries({
  authRouter,
  requireLogin,
  'vetModule.router': vetModule.router,
  'derivacionesModule.router': derivacionesModule.router,
  'derivacionesModule.iaRouter': derivacionesModule.iaRouter,
  'planModule.router': planModule.router,
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
    maxAge: 8 * 3600000 // 8 horas
  }
  // Nota: el store por defecto es en memoria — para producción con más de una
  // instancia del servidor, usa connect-redis u otro store compartido.
}));

app.get('/', (req, res) => res.send('Servidor de WhatsApp — Clínica Echeverría activo ✅'));

// El webhook de Meta NO lleva autenticación (Meta no puede loguearse)
app.use('/webhook', webhookRoutes);

// Login/logout — públicos, es lo que permite entrar
app.use('/api/auth', authRouter);

// Bandeja de derivaciones del panel: sesión + rol (recepcion/direccion)
app.use('/api/derivaciones', requireLogin, derivacionesModule.router);

// Estado del plan para pintar candados en el panel; POST /pruebas activa la prueba de 3 días.
app.use('/api/plan', requireLogin, planModule.router);
// Cita manual desde el calendario del panel: mismo motor de reservas del asistente, sin x-api-key
// en el navegador, y confirmación por WhatsApp en caliente.
app.use(
  '/api/citas/manual',
  requireLogin,
  requireRole('recepcion', 'direccion'),
  citaManualRouter({ scheduler: vetModule.scheduler, notifier: wa })
);
app.use('/api', requireLogin, adminApiRoutes);
// Servicios para el Asistente de WhatsApp: API key, sin sesión.
// Deben ir ANTES de app.use('/api', requireLogin, ...) o requireLogin respondería 401.
app.use('/api/ia/derivaciones', iaApiKey, derivacionesModule.iaRouter);
app.use('/api/vet', iaApiKey, vetModule.router);

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
  console.log(`URL del webhook a configurar en Meta: https://TU_DOMINIO_O_NGROK/webhook`);
});
