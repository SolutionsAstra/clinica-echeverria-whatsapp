const { rateLimit } = require('express-rate-limit');

/** 10 intentos FALLIDOS por IP cada 15 min. Los logins correctos no consumen cupo. */
function crearLimiteLogin({ windowMs = 15 * 60_000, limit = 10 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) =>
      res.status(429).json({ error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' }),
  });
}

module.exports = { crearLimiteLogin };
