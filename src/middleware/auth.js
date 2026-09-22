// middleware/auth.js
// Autenticación por sesión (cookie) con 3 roles: recepcion, doctor, direccion.
// Reemplaza la autenticación básica compartida de la versión anterior.

function requireLogin(req, res, next) {
  if (req.session?.usuario) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// requireRole('direccion') o requireRole('direccion', 'recepcion') — cualquiera de los roles listados pasa.
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (!rolesPermitidos.includes(req.session.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
