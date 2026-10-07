/**
 * Calendario semanal de UN doctor — lógica pura (sin React), probada con `node --test`.
 *
 * Entrada: CitaDetallada[] de GET /api/citas (src/db.ts → listarCitas). Todo se calcula en la
 * hora de la clínica (America/Caracas), nunca en la del navegador de la recepcionista.
 *
 * Invariantes de salida (semana.test.js las verifica con 500 citas solapadas):
 *   - 0 ≤ inicioMin < finMin ≤ 1440 en cada bloque y en la ventana de la semana.
 *   - 1 ≤ carriles ≤ MAX_CARRILES y 0 ≤ carril < carriles: nunca hay división por cero ni anchos negativos.
 *   - Si un grupo necesita más carriles, el último se reserva para un "+N" con las citas que no caben.
 *   - Un id repetido se dibuja una sola vez: las claves de React son únicas.
 */
import { ZONA_CLINICA } from "../workspace/agenda.js";

const HORARIO_POR_DEFECTO = { dias: [1, 2, 3, 4, 5], hora_inicio: "08:00", hora_fin: "17:00" };
const DURACION_MINIMA_MIN = 15;
const MIN_DIA = 24 * 60;
const DIAS_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Carriles dibujables por grupo de solapes. Con 4, el más angosto mide 1/4 de la columna (≈ 34 px). */
export const MAX_CARRILES = 4;
/** Citas listadas en el detalle accesible de un "+N" (el número siempre es el total real). */
const MAX_DETALLE_EXCEDENTE = 20;

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));

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
    // Algunos motores de Intl devuelven "24" a medianoche aun con h23: % 24 lo lleva a 00.
    minutos: (Number(p.hour) % 24) * 60 + Number(p.minute),
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
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof hhmm === "string" ? hhmm : "");
  if (!m) return defecto;
  const valor = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(valor) ? limitar(valor, 0, MIN_DIA) : defecto;
};

/** Orden estable para ids numéricos o de texto ("7" < "10", "a-2" < "a-10"). */
const compararId = (a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true });

/** Une en franjas continuas las citas que no caben, para pintar un "+N" por franja. */
function fusionarExcedentes(ocultos, tope, numeroGrupo) {
  const orden = [...ocultos].sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin || compararId(a, b));
  const franjas = [];
  let actual = null;
  for (const b of orden) {
    if (actual && b.inicioMin < actual.finMin) {
      actual.finMin = Math.max(actual.finMin, b.finMin);
      actual.citas.push(b);
    } else {
      actual = { inicioMin: b.inicioMin, finMin: b.finMin, citas: [b] };
      franjas.push(actual);
    }
  }
  return franjas.map((f, i) => ({
    id: `mas-${numeroGrupo}-${i}`,
    carril: tope - 1,
    carriles: tope,
    inicioMin: f.inicioMin,
    finMin: f.finMin,
    cantidad: f.citas.length,
    detalle: f.citas.slice(0, MAX_DETALLE_EXCEDENTE).map((b) => ({ id: b.id, inicioMin: b.inicioMin, paciente: b.paciente })),
  }));
}

/**
 * Reparte citas solapadas en carriles. Dos citas que se tocan (09:00 fin / 09:00 inicio) no se solapan.
 * Grupo = citas unidas por solapes transitivos; todas comparten el mismo número de carriles.
 * @returns {{ bloques: object[], excedentes: object[] }}
 */
export function asignarCarriles(bloques, maxCarriles = MAX_CARRILES) {
  const tope = Math.max(2, Math.floor(maxCarriles) || MAX_CARRILES);
  const ordenados = [...bloques].sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin || compararId(a, b));
  const salida = [];
  const excedentes = [];
  let grupo = [];
  let finGrupo = -Infinity;
  let carriles = []; // fin del último bloque de cada carril
  let numeroGrupo = 0;

  const cerrarGrupo = () => {
    if (grupo.length === 0) return;
    const total = carriles.length; // ≥ 1: cada bloque ocupa un carril
    if (total <= tope) {
      for (const b of grupo) salida.push({ ...b, carriles: total, carrilesReales: total });
    } else {
      const ocultos = [];
      for (const b of grupo) {
        if (b.carril < tope - 1) salida.push({ ...b, carriles: tope, carrilesReales: total });
        else ocultos.push(b);
      }
      excedentes.push(...fusionarExcedentes(ocultos, tope, numeroGrupo));
    }
    numeroGrupo += 1;
    grupo = [];
    carriles = [];
    finGrupo = -Infinity;
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
  return { bloques: salida, excedentes };
}

/**
 * @param {object[]} citas  CitaDetallada[]
 * @param {{ doctorId: number|null, lunes: string, horario?: { dias?: number[], hora_inicio?: string, hora_fin?: string },
 *           zona?: string, ocultas?: Set<string> }} opciones
 */
export function maquetarSemana(citas, { doctorId, lunes, horario, zona = ZONA_CLINICA, ocultas = new Set() }) {
  const domingo = sumarDias(lunes, 6);
  let canceladas = 0;
  let duplicadas = 0;
  const vistos = new Set();
  const citasSemana = [];

  for (const c of Array.isArray(citas) ? citas : []) {
    if (!c || typeof c !== "object") continue;
    // doctorId null = vista unificada (módulo Multi-Calendario): todos los doctores.
    if (doctorId != null && Number(c.doctor_id) !== Number(doctorId)) continue;
    const inicio = Date.parse(c.fecha_hora_inicio);
    if (!Number.isFinite(inicio)) continue;
    const p = partesEnZona(inicio, zona);
    if (p.dia < lunes || p.dia > domingo) continue;

    // Una misma cita repetida en la respuesta se dibuja una vez (claves de React únicas).
    const clave = c.id != null ? String(c.id) : null;
    if (clave !== null) {
      if (vistos.has(clave)) {
        duplicadas += 1;
        continue;
      }
      vistos.add(clave);
    }

    if (c.estado === "cancelada") {
      canceladas += 1;
      continue;
    }

    const inicioMin = limitar(p.minutos, 0, MIN_DIA - 1);
    if (!Number.isFinite(inicioMin)) continue;
    const finMs = Date.parse(c.fecha_hora_fin);
    const duracion = Number.isFinite(finMs) && finMs > inicio ? Math.round((finMs - inicio) / 60000) : 0;
    // Una cita que cruza la medianoche se recorta a 24:00 en su día de inicio.
    const finMin = Math.min(MIN_DIA, inicioMin + Math.max(DURACION_MINIMA_MIN, duracion));

    citasSemana.push({
      id: c.id ?? `sin-id-${citasSemana.length}`,
      dia: p.dia,
      inicioMin,
      finMin,
      especialidad: c.especialidad_codigo ?? "desconocida",
      especialidadNombre: c.especialidad_nombre,
      paciente: c.paciente_nombre,
      doctor: c.doctor_nombre,
      estado: c.estado,
      inicioIso: c.fecha_hora_inicio,
    });
  }

  const visibles = citasSemana.filter((b) => !ocultas.has(b.especialidad));
  const h = { ...HORARIO_POR_DEFECTO, ...(horario ?? {}) };
  // Bucle en vez de Math.min(...arr): sin límite de argumentos con miles de citas.
  let minInicio = aMinutos(h.hora_inicio, 480);
  let maxFin = aMinutos(h.hora_fin, 1020);
  for (const b of visibles) {
    if (b.inicioMin < minInicio) minInicio = b.inicioMin;
    if (b.finMin > maxFin) maxFin = b.finMin;
  }
  const inicioMin = limitar(Math.floor(minInicio / 60) * 60, 0, MIN_DIA - 60);
  const finMin = Math.min(MIN_DIA, Math.max(inicioMin + 60, Math.ceil(maxFin / 60) * 60));

  const laborables = Array.isArray(horario?.dias) && horario.dias.length ? horario.dias : HORARIO_POR_DEFECTO.dias;
  const dias = diasVisibles(lunes, horario?.dias, new Set(citasSemana.map((b) => b.dia)));
  const columnas = dias.map(({ dia, diaSemana }) => {
    const { bloques, excedentes } = asignarCarriles(visibles.filter((b) => b.dia === dia));
    return { dia, diaSemana, laborable: laborables.includes(diaSemana), bloques, excedentes };
  });

  return { columnas, inicioMin, finMin, canceladas, duplicadas, total: citasSemana.length, citasSemana };
}

/** Conteo por especialidad para la leyenda (incluye las ocultas por filtro). */
export function resumenPorEspecialidad(citasSemana) {
  const conteo = new Map();
  for (const b of citasSemana ?? []) {
    const codigo = b?.especialidad ?? "desconocida";
    conteo.set(codigo, (conteo.get(codigo) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .map(([codigo, total]) => ({ codigo, total }))
    .sort((a, b) => b.total - a.total || String(a.codigo).localeCompare(String(b.codigo)));
}

/** Derivaciones del agente IA para este doctor, en orden de llegada (la más antigua primero). */
export function derivacionesEnEspera(derivaciones, doctorId) {
  return (Array.isArray(derivaciones) ? derivaciones : [])
    .filter((d) => Number(d?.doctorId) === Number(doctorId))
    .sort((a, b) => Date.parse(a.capturadaEn) - Date.parse(b.capturadaEn));
}