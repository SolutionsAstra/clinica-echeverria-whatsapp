/**
 * Calendario semanal de UN doctor — lógica pura (sin React), probada con `node --test`.
 *
 * Entrada: CitaDetallada[] de GET /api/citas (src/db.ts → listarCitas). Todo se calcula en la
 * hora de la clínica (America/Caracas), nunca en la del navegador de la recepcionista.
 */
import { ZONA_CLINICA } from "../workspace/agenda.js";

const HORARIO_POR_DEFECTO = { dias: [1, 2, 3, 4, 5], hora_inicio: "08:00", hora_fin: "17:00" };
const DURACION_MINIMA_MIN = 15;
const DIAS_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formateadores = new Map();
function formateador(zona) {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formateadores.set(zona, f);
  }
  return f;
}

/** Día, minuto del día y día de la semana (0 = domingo) del instante, en el huso de la clínica. */
export function partesEnZona(ms, zona = ZONA_CLINICA) {
  const p = Object.fromEntries(formateador(zona).formatToParts(ms).map(({ type, value }) => [type, value]));
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    diaSemana: DIAS_SEMANA[p.weekday],
  };
}

/* Aritmética de fechas sobre cadenas "YYYY-MM-DD" en UTC: sin husos ni horario de verano. */
const aUtc = (dia) => Date.parse(`${dia}T00:00:00Z`);
const deUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export function sumarDias(dia, n) {
  return deUtc(aUtc(dia) + n * 86_400_000);
}

/** Lunes de la semana del día dado (la semana cierra en domingo). */
export function lunesDe(dia) {
  const diaSemana = new Date(aUtc(dia)).getUTCDay();
  return sumarDias(dia, diaSemana === 0 ? -6 : 1 - diaSemana);
}

/** Días a pintar: los de atención del doctor más cualquier día con citas esa semana. */
export function diasVisibles(lunes, diasLaborables, diasConCitas = new Set()) {
  const laborables = Array.isArray(diasLaborables) && diasLaborables.length ? diasLaborables : HORARIO_POR_DEFECTO.dias;
  const dias = [];
  for (let i = 0; i < 7; i += 1) {
    const dia = sumarDias(lunes, i);
    const diaSemana = (i + 1) % 7;
    if (laborables.includes(diaSemana) || diasConCitas.has(dia)) dias.push({ dia, diaSemana });
  }
  return dias;
}

const aMinutos = (hhmm, defecto) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : defecto;
};

/** Reparte citas solapadas en carriles. Dos citas que se tocan (09:00 fin / 09:00 inicio) no se solapan. */
function asignarCarriles(bloques) {
  const ordenados = [...bloques].sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin || a.id - b.id);
  const resultado = [];
  let grupo = [];
  let finGrupo = -1;
  let carriles = [];

  const cerrarGrupo = () => {
    for (const b of grupo) resultado.push({ ...b, carriles: carriles.length });
    grupo = [];
    carriles = [];
  };

  for (const b of ordenados) {
    if (grupo.length && b.inicioMin >= finGrupo) cerrarGrupo();
    let carril = carriles.findIndex((fin) => fin <= b.inicioMin);
    if (carril === -1) {
      carril = carriles.length;
      carriles.push(b.finMin);
    } else {
      carriles[carril] = b.finMin;
    }
    grupo.push({ ...b, carril });
    finGrupo = Math.max(finGrupo, b.finMin);
  }
  cerrarGrupo();
  return resultado;
}

/**
 * @param {object[]} citas  CitaDetallada[]
 * @param {{ doctorId: number|null, lunes: string, horario?: { dias?: number[], hora_inicio?: string, hora_fin?: string },
 *           zona?: string, ocultas?: Set<string> }} opciones
 */
export function maquetarSemana(citas, { doctorId, lunes, horario, zona = ZONA_CLINICA, ocultas = new Set() }) {
  const domingo = sumarDias(lunes, 6);
  let canceladas = 0;
  const citasSemana = [];

  for (const c of Array.isArray(citas) ? citas : []) {
    // doctorId null = vista unificada (módulo Multi-Calendario): todos los doctores.
    if (doctorId != null && Number(c?.doctor_id) !== Number(doctorId)) continue;
    const inicio = Date.parse(c.fecha_hora_inicio);
    if (!Number.isFinite(inicio)) continue;
    const p = partesEnZona(inicio, zona);
    if (p.dia < lunes || p.dia > domingo) continue;
    if (c.estado === "cancelada") {
      canceladas += 1;
      continue;
    }
    const finMs = Date.parse(c.fecha_hora_fin);
    const duracion = Number.isFinite(finMs) ? Math.round((finMs - inicio) / 60000) : 0;
    citasSemana.push({
      id: c.id,
      dia: p.dia,
      inicioMin: p.minutos,
      finMin: Math.min(24 * 60, p.minutos + Math.max(DURACION_MINIMA_MIN, duracion)),
      especialidad: c.especialidad_codigo,
      especialidadNombre: c.especialidad_nombre,
      paciente: c.paciente_nombre,
      doctor: c.doctor_nombre,
      estado: c.estado,
      inicioIso: c.fecha_hora_inicio,
    });
  }

  const visibles = citasSemana.filter((b) => !ocultas.has(b.especialidad));
  const h = { ...HORARIO_POR_DEFECTO, ...(horario ?? {}) };
  const minInicio = Math.min(aMinutos(h.hora_inicio, 480), ...visibles.map((b) => b.inicioMin));
  const maxFin = Math.max(aMinutos(h.hora_fin, 1020), ...visibles.map((b) => b.finMin));
  const inicioMin = Math.floor(minInicio / 60) * 60;
  const finMin = Math.min(24 * 60, Math.max(inicioMin + 60, Math.ceil(maxFin / 60) * 60));

  const dias = diasVisibles(lunes, horario?.dias, new Set(citasSemana.map((b) => b.dia)));
  const columnas = dias.map(({ dia, diaSemana }) => ({
    dia,
    diaSemana,
    laborable: (Array.isArray(horario?.dias) && horario.dias.length ? horario.dias : HORARIO_POR_DEFECTO.dias).includes(
      diaSemana,
    ),
    bloques: asignarCarriles(visibles.filter((b) => b.dia === dia)),
  }));

  return { columnas, inicioMin, finMin, canceladas, total: citasSemana.length, citasSemana };
}

/** Conteo por especialidad para la leyenda (incluye las ocultas por filtro). */
export function resumenPorEspecialidad(citasSemana) {
  const conteo = new Map();
  for (const b of citasSemana ?? []) conteo.set(b.especialidad, (conteo.get(b.especialidad) ?? 0) + 1);
  return [...conteo.entries()]
    .map(([codigo, total]) => ({ codigo, total }))
    .sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo));
}

/** Derivaciones del agente IA para este doctor, en orden de llegada (la más antigua primero). */
export function derivacionesEnEspera(derivaciones, doctorId) {
  return (Array.isArray(derivaciones) ? derivaciones : [])
    .filter((d) => Number(d?.doctorId) === Number(doctorId))
    .sort((a, b) => Date.parse(a.capturadaEn) - Date.parse(b.capturadaEn));
}
