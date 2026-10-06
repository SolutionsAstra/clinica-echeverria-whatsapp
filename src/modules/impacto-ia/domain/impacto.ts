/**
 * Impacto del Agendamiento con IA: compara el periodo de la prueba (o los últimos 7 días)
 * con un periodo anterior de IGUAL duración. Lógica pura, sin I/O.
 */
const DIA_MS = 86_400_000;
export const DIAS_SIN_PRUEBA = 7;

export interface Ventana {
  desde: Date;
  hasta: Date;
}

export interface PruebaFechas {
  iniciadaEn: Date;
  expiraEn: Date;
}

export interface DerivacionMetrica {
  capturadaEn: Date;
  reservadaEn: Date | null;
  estado: string;
}

export interface Resumen {
  /** Citas creadas por la IA (sin contar las luego canceladas). */
  citasIa: number;
  citasIaFueraDeHorario: number;
  /** Solicitudes que el bot derivó a recepción. */
  derivacionesRecibidas: number;
  derivacionesFueraDeHorario: number;
  derivacionesReservadas: number;
  /** Pendientes, en proceso o descartadas: pacientes que aún no tienen cita. */
  derivacionesSinReservar: number;
  /** Promedio captura → reserva de recepción, en minutos. null si no hubo reservas. */
  esperaPromedioMin: number | null;
}

export type Fuente = "prueba" | "ultimos_7_dias";

export function calcularVentanas(prueba: PruebaFechas | null, ahora: Date) {
  let desde: Date;
  let hasta: Date;
  let fuente: Fuente;
  if (prueba) {
    desde = prueba.iniciadaEn;
    hasta = new Date(Math.min(prueba.expiraEn.getTime(), ahora.getTime()));
    fuente = "prueba";
  } else {
    hasta = ahora;
    desde = new Date(ahora.getTime() - DIAS_SIN_PRUEBA * DIA_MS);
    fuente = "ultimos_7_dias";
  }
  // Mismo largo que el periodo actual: a mitad de la prueba se comparan 3 días contra 3 días.
  const largo = Math.max(0, hasta.getTime() - desde.getTime());
  return {
    fuente,
    pruebaVigente: Boolean(prueba) && prueba!.expiraEn.getTime() > ahora.getTime(),
    actual: { desde, hasta } as Ventana,
    anterior: { desde: new Date(desde.getTime() - largo), hasta: desde } as Ventana,
  };
}

export function resumir(
  v: Ventana,
  citasIa: readonly Date[],
  derivaciones: readonly DerivacionMetrica[],
  esFueraDeHorario: (fecha: Date) => boolean,
): Resumen {
  const dentro = (d: Date) => d.getTime() >= v.desde.getTime() && d.getTime() < v.hasta.getTime();
  const citas = citasIa.filter(dentro);
  const der = derivaciones.filter((x) => dentro(x.capturadaEn));
  const reservadas = der.filter((x) => x.estado === "reservada" && x.reservadaEn !== null);
  const esperas = reservadas
    .map((x) => (x.reservadaEn!.getTime() - x.capturadaEn.getTime()) / 60_000)
    .filter((m) => m >= 0);

  return {
    citasIa: citas.length,
    citasIaFueraDeHorario: citas.filter((d) => esFueraDeHorario(d)).length,
    derivacionesRecibidas: der.length,
    derivacionesFueraDeHorario: der.filter((x) => esFueraDeHorario(x.capturadaEn)).length,
    derivacionesReservadas: reservadas.length,
    derivacionesSinReservar: der.length - reservadas.length,
    esperaPromedioMin: esperas.length ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : null,
  };
}