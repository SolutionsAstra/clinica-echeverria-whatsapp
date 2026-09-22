// sessions.js
// Estado de la conversación por número de teléfono. En memoria para el MVP;
// para producción con varias réplicas del servidor, mover esto a Redis.

const sesiones = new Map();

function get(telefono) {
  if (!sesiones.has(telefono)) {
    sesiones.set(telefono, { paso: 'inicio', datos: {} });
  }
  return sesiones.get(telefono);
}

function set(telefono, sesion) {
  sesiones.set(telefono, sesion);
}

function reset(telefono) {
  sesiones.set(telefono, { paso: 'inicio', datos: {} });
}

module.exports = { get, set, reset };
