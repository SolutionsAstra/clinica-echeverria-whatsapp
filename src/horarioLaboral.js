// horarioLaboral.js
// Ventana de atención humana del centro: lunes a viernes, 09:00–18:00, America/Caracas.
// Puro (sin I/O): recibe la hora y no depende del huso del servidor.
// 18:00 cuenta como dentro de horario; desde las 18:01 es fuera de horario.
// Feriados no contemplados: si se requieren, agrégalos a FERIADOS (YYYY-MM-DD, hora de Caracas).

const TZ = 'America/Caracas';
const APERTURA_MIN = 9 * 60;
const CIERRE_MIN = 18 * 60;
const DIAS_HABILES = new Set([1, 2, 3, 4, 5]); // 0 = domingo
const FERIADOS = new Set((process.env.FERIADOS || '').split(',').map((s) => s.trim()).filter(Boolean));
const DESCRIPCION_HORARIO = 'lunes a viernes, de 09:00 a 18:00 (hora de Venezuela)';

const NUM_DIA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const formato = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function partesCaracas(ahora) {
  const p = Object.fromEntries(formato.formatToParts(ahora).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    diaSemana: NUM_DIA[p.weekday],
    minutos: Number(p.hour) * 60 + Number(p.minute),
  };
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const esHabil = (fecha, diaSemana) => DIAS_HABILES.has(diaSemana) && !FERIADOS.has(fecha);

/**
 * @returns {{ dentroDeHorario: boolean, proximaApertura: string|null }}
 *   proximaApertura: texto listo para el paciente ("mañana a partir de las 09:00").
 */
function estadoHorario(ahora = new Date()) {
  const { fecha, diaSemana, minutos } = partesCaracas(ahora);
  const habilHoy = esHabil(fecha, diaSemana);

  if (habilHoy && minutos >= APERTURA_MIN && minutos <= CIERRE_MIN) {
    return { dentroDeHorario: true, proximaApertura: null };
  }
  if (habilHoy && minutos < APERTURA_MIN) {
    return { dentroDeHorario: false, proximaApertura: 'hoy a partir de las 09:00' };
  }
  for (let k = 1; k <= 14; k++) {
    const f = sumarDias(fecha, k);
    const dia = (diaSemana + k) % 7;
    if (esHabil(f, dia)) {
      const cuando = k === 1 ? 'mañana' : `el ${NOMBRE_DIA[dia]}`;
      return { dentroDeHorario: false, proximaApertura: `${cuando} a partir de las 09:00` };
    }
  }
  return { dentroDeHorario: false, proximaApertura: 'el próximo día hábil' };
}

module.exports = { TZ, DESCRIPCION_HORARIO, estadoHorario };