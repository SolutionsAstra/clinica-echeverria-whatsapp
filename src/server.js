require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const webhookRoutes = require('./routes/webhook');
const authRoutes = require('./routes/authRoutes');
const adminApiRoutes = require('./routes/adminApi');
const { requireLogin } = require('./middleware/auth');
require('./jobs/reminders');
require('./jobs/reportJob');

const app = express();
app.use(express.json());

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
app.use('/api/auth', authRoutes);

// El HTML/CSS/JS del panel es público (sin datos sensibles); la seguridad real
// está en que cada llamada a /api/* exige sesión y, en varios casos, un rol.
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/api', requireLogin, adminApiRoutes);

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
