// availability.js
// Calcula horarios disponibles respetando horario laboral, buffer entre citas,
// bloqueo del recurso físico (ej. EEG) y ventana mínima de reserva.
// Ahora consulta directamente la base de datos SQL en vez de un objeto en memoria.

const db = require('./db');

const BUFFER_MIN = 15;
const MIN_HORAS_ANTICIPACION = 2;

function overlap(aInicio, aFin, bInicio, bFin) {
  return aInicio < bFin && bInicio < aFin;
}

function generarSlotsDelDia(fecha, horaInicio, horaFin, duracionMin) {
  const slots = [];
  const [hi, mi] = horaInicio.split(':').map(Number);
  const [hf, mf] = horaFin.split(':').map(Number);
  let cursor = new Date(fecha); cursor.setHours(hi, mi, 0, 0);
  const fin = new Date(fecha); fin.setHours(hf, mf, 0, 0);

  while (true) {
    const finSlot = new Date(cursor.getTime() + duracionMin * 60000);
    if (finSlot > fin) break;
    slots.push({ inicio: new Date(cursor), fin: finSlot });
    cursor = new Date(cursor.getTime() + (duracionMin + BUFFER_MIN) * 60000);
  }
  return slots;
}

/**
 * Devuelve los próximos slots libres para un doctor + especialidad.
 */
async function slotsDisponibles({ doctorId, especialidadKey, diasAdelante = 5, maxResultados = 6 }) {
  const especialidad = await db.getEspecialidadPorCodigo(especialidadKey);
  const horario = await db.getHorarioDoctor(doctorId);
  if (!especialidad || !horario) return [];

  const recursoRequerido = especialidad.requiere_recurso
    ? await db.getRecursoPorTipo('equipo_eeg')
    : null;

  const { citasDoctor, citasRecurso } = await db.citasFuturasDelDoctorYRecurso(
    doctorId, recursoRequerido ? recursoRequerido.id : null, diasAdelante
  );

  const ahora = new Date();
  const limiteMin = new Date(ahora.getTime() + MIN_HORAS_ANTICIPACION * 3600000);
  const resultados = [];

  for (let d = 0; d < diasAdelante && resultados.length < maxResultados; d++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + d);
    const diaSemana = fecha.getDay();
    if (!horario.dias.includes(diaSemana)) continue;

    const slots = generarSlotsDelDia(fecha, horario.hora_inicio, horario.hora_fin, especialidad.duracion_min);

    for (const slot of slots) {
      if (slot.inicio < limiteMin) continue;

      const chocaConDoctor = citasDoctor.some(c =>
        overlap(slot.inicio, slot.fin, new Date(c.fecha_hora_inicio), new Date(c.fecha_hora_fin))
      );
      if (chocaConDoctor) continue;

      if (recursoRequerido) {
        const chocaConRecurso = citasRecurso.some(c =>
          overlap(slot.inicio, slot.fin, new Date(c.fecha_hora_inicio), new Date(c.fecha_hora_fin))
        );
        if (chocaConRecurso) continue;
      }

      resultados.push({ inicio: slot.inicio, fin: slot.fin, recurso_id: recursoRequerido ? recursoRequerido.id : null });
      if (resultados.length >= maxResultados) break;
    }
  }
  return resultados;
}

module.exports = { slotsDisponibles, BUFFER_MIN, MIN_HORAS_ANTICIPACION };
