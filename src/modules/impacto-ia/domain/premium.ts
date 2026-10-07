/**
 * Métricas premium de Reportes (Dirección). Lógica pura, sin I/O.
 *   1. Analítica Avanzada de Ausentismo (Pacientes Inasistentes) — por especialidad.
 *   2. Tasa de Conversión Conversacional de la IA — solicitudes de cita por WhatsApp → cita confirmada.
 *   3. Ingresos Proyectados Fuera de Horario Laboral — citas de la IA creadas con la recepción cerrada × tarifa.
 * Las tarifas vienen de configuración (TARIFAS_CONSULTA); sin tarifas, el monto es null, nunca inventado.
 */
import { isSpecialty } from "../../vet";
import type { DerivacionMetrica, Ventana } from "./impacto";

export interface CitaMetrica {
  creadoEn: Date;
  inicio: Date;
  estado: string;
  origen: string | null;
  especialidad: string;
}

export interface Tarifas {
  moneda: string;
  porEspecialidad: Readonly<Record<string, number>>;
}

export const TARIFAS_VACIAS: Tarifas = Object.freeze({ moneda: "USD", porEspecialidad: Object.freeze({}) });

export interface AusentismoEspecialidad {
  especialidad: string;
  ocurridas: number;
  inasistentes: number;
  tasa: number | null;
}

export interface MetricasPremium {
  ausentismo: { ocurridas: number; inasistentes: number; tasa: number | null; porEspecialidad: AusentismoEspecialidad[] };
  conversion: {
    solicitudes: number;
    citasIa: number;
    reservadasPorRecepcion: number;
    sinCita: number;
    /** % de solicitudes que la IA convirtió en cita sin intervención humana. */
    tasaAutonoma: number | null;
    /** % convertido sumando lo que agendó recepción desde la bandeja. */
    tasaTotal: number | null;
  };
  ingresosFueraDeHorario: {
    citas: number;
    citasSinTarifa: number;
    monto: number | null;
    porEspecialidad: Array<{ especialidad: string; citas: number; tarifa: number | null; monto: number | null }>;
  };
}

const OCURRIDAS = new Set(["confirmada", "completada", "no_show"]);
const pct = (parte: number, total: number): number | null => (total > 0 ? Math.round((parte / total) * 100) : null);
const dosDecimales = (n: number) => Math.round(n * 100) / 100;

export function calcularPremium(
  v: Ventana,
  ahora: Date,
  citas: readonly CitaMetrica[],
  derivaciones: readonly DerivacionMetrica[],
  esFueraDeHorario: (fecha: Date) => boolean,
  tarifas: Tarifas = TARIFAS_VACIAS,
): MetricasPremium {
  const desde = v.desde.getTime();
  const hasta = v.hasta.getTime();
  const enVentana = (d: Date) => d.getTime() >= desde && d.getTime() < hasta;

  // 1) Ausentismo: citas con inicio ya ocurrido dentro de la ventana.
  const finOcurridas = Math.min(hasta, ahora.getTime());
  const porEsp = new Map<string, { ocurridas: number; inasistentes: number }>();
  let ocurridas = 0;
  let inasistentes = 0;
  for (const c of citas) {
    const inicio = c.inicio.getTime();
    if (inicio < desde || inicio >= finOcurridas || !OCURRIDAS.has(c.estado)) continue;
    const inasistente = c.estado === "no_show";
    ocurridas += 1;
    if (inasistente) inasistentes += 1;
    const f = porEsp.get(c.especialidad) ?? { ocurridas: 0, inasistentes: 0 };
    f.ocurridas += 1;
    if (inasistente) f.inasistentes += 1;
    porEsp.set(c.especialidad, f);
  }
  const porEspecialidad = [...porEsp]
    .map(([especialidad, f]) => ({ especialidad, ...f, tasa: pct(f.inasistentes, f.ocurridas) }))
    .sort((a, b) => (b.tasa ?? 0) - (a.tasa ?? 0) || b.ocurridas - a.ocurridas || a.especialidad.localeCompare(b.especialidad));

  // 2) Conversión: cada solicitud de cita por WhatsApp termina en cita de la IA o en la bandeja de recepción.
  const citasIa = citas.filter((c) => c.origen === "ia" && c.estado !== "cancelada" && enVentana(c.creadoEn));
  const der = derivaciones.filter((d) => enVentana(d.capturadaEn));
  const reservadas = der.filter((d) => d.estado === "reservada").length;
  const solicitudes = citasIa.length + der.length;

  // 3) Ingresos proyectados de lo que la IA agendó con la recepción cerrada.
  const fuera = citasIa.filter((c) => esFueraDeHorario(c.creadoEn));
  const configuradas = Object.keys(tarifas.porEspecialidad).length > 0;
  const grupos = new Map<string, number>();
  for (const c of fuera) grupos.set(c.especialidad, (grupos.get(c.especialidad) ?? 0) + 1);
  let total = 0;
  let sinTarifa = 0;
  const ingresosPorEsp = [...grupos].map(([especialidad, n]) => {
    const tarifa = tarifas.porEspecialidad[especialidad];
    if (!Number.isFinite(tarifa)) {
      sinTarifa += n;
      return { especialidad, citas: n, tarifa: null, monto: null };
    }
    const monto = dosDecimales(n * tarifa);
    total += monto;
    return { especialidad, citas: n, tarifa, monto };
  });
  ingresosPorEsp.sort((a, b) => (b.monto ?? -1) - (a.monto ?? -1) || b.citas - a.citas);

  return {
    ausentismo: { ocurridas, inasistentes, tasa: pct(inasistentes, ocurridas), porEspecialidad },
    conversion: {
      solicitudes,
      citasIa: citasIa.length,
      reservadasPorRecepcion: reservadas,
      sinCita: solicitudes - citasIa.length - reservadas,
      tasaAutonoma: pct(citasIa.length, solicitudes),
      tasaTotal: pct(citasIa.length + reservadas, solicitudes),
    },
    ingresosFueraDeHorario: {
      citas: fuera.length,
      citasSinTarifa: sinTarifa,
      monto: configuradas ? dosDecimales(total) : null,
      porEspecialidad: ingresosPorEsp,
    },
  };
}

/**
 * TARIFAS_CONSULTA='{"pediatria":30,"neurologia":60,"estetica":50,"eeg":80}'  MONEDA_TARIFAS=USD
 * Ignora claves desconocidas y montos inválidos; devuelve avisos para el log del arranque.
 */
export function parsearTarifas(raw: string | undefined, moneda = "USD"): { tarifas: Tarifas; avisos: string[] } {
  const avisos: string[] = [];
  const porEspecialidad: Record<string, number> = {};
  if (raw && raw.trim()) {
    try {
      const obj: unknown = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("no es un objeto");
      for (const [clave, valor] of Object.entries(obj as Record<string, unknown>)) {
        if (!isSpecialty(clave)) avisos.push(`TARIFAS_CONSULTA: especialidad desconocida '${clave}'`);
        else if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) avisos.push(`TARIFAS_CONSULTA: monto inválido para '${clave}'`);
        else porEspecialidad[clave] = valor;
      }
    } catch {
      avisos.push("TARIFAS_CONSULTA no es un JSON válido; los ingresos proyectados quedan sin monto");
    }
  }
  const codigo = typeof moneda === "string" && /^[A-Z]{3}$/.test(moneda) ? moneda : "USD";
  return { tarifas: { moneda: codigo, porEspecialidad }, avisos };
}