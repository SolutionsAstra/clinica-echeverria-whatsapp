// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Faltan email o contraseña' });

    const usuario = await db.getUsuarioPorEmail(email.toLowerCase().trim());
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    req.session.usuario = {
      id: usuario.id, nombre: usuario.nombre, email: usuario.email,
      rol: usuario.rol, doctor_id: usuario.doctor_id || null
    };
    res.json({ ok: true, usuario: req.session.usuario });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.session.usuario);
});

module.exports = router;
