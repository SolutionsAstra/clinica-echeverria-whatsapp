import { calcularVentanas, resumir, type DerivacionMetrica, type Fuente, type PruebaFechas, type Resumen, type Ventana } from "../domain/impacto";
import { calcularPremium, TARIFAS_VACIAS, type CitaMetrica, type MetricasPremium, type Tarifas } from "../domain/premium";

export interface ImpactoRepository {
  /** creado_en de citas con origen 'ia' no canceladas, en [desde, hasta). */
  citasIa(desde: Date, hasta: Date): Promise<Date[]>;
  derivaciones(desde: Date, hasta: Date): Promise<DerivacionMetrica[]>;
  /** Citas creadas o con inicio en [desde, hasta), para las métricas premium de Reportes. */
  citasPeriodo?(desde: Date, hasta: Date): Promise<CitaMetrica[]>;
}

export interface EstadoModuloIa {
  habilitado: boolean;
  origen: "contrato" | "prueba" | null;
  pruebaExpiraEn: string | null;
}

export type ResumenVentana = Resumen & { desde: string; hasta: string };
export type MetricasPremiumVentana = MetricasPremium & { desde: string; hasta: string };

/** Métricas de Reportes: últimos 7 días contra los 7 anteriores. null = módulo Reportes cerrado. */
export interface PremiumDto {
  moneda: string;
  tarifasConfiguradas: boolean;
  actual: MetricasPremiumVentana;
  anterior: MetricasPremiumVentana;
}

/** Contrato EXACTO de GET /api/impacto-ia. */
export interface ImpactoIaDto {
  fuente: Fuente;
  pruebaVigente: boolean;
  modulo: EstadoModuloIa;
  actual: ResumenVentana;
  anterior: ResumenVentana;
  premium: PremiumDto | null;
}

export interface ImpactoIaService {
  resumen(): Promise<ImpactoIaDto>;
}

export function createImpactoIaService(deps: {
  repository: ImpactoRepository;
  /** planModule.service.pruebaDe('agendamiento_ia') */
  pruebaAgendamiento: () => Promise<PruebaFechas | null>;
  /** Estado actual del módulo (contrato / prueba / bloqueado). */
  estadoModulo: () => Promise<EstadoModuloIa>;
  /** Misma regla que el bot: !estadoHorario(fecha).dentroDeHorario (America/Caracas + FERIADOS). */
  esFueraDeHorario: (fecha: Date) => boolean;
  /** Módulo Reportes contratado o en prueba. Sin esta dependencia, premium = null. */
  reportesHabilitado?: () => Promise<boolean>;
  tarifas?: Tarifas;
  reloj?: () => Date;
}): ImpactoIaService {
  const reloj = deps.reloj ?? (() => new Date());
  const tarifas = deps.tarifas ?? TARIFAS_VACIAS;
  const repo = deps.repository;

  const premiumDisponible = async () =>
    typeof repo.citasPeriodo === "function" && deps.reportesHabilitado ? Boolean(await deps.reportesHabilitado()) : false;

  return {
    async resumen() {
      const ahora = reloj();
      const [prueba, modulo, conPremium] = await Promise.all([deps.pruebaAgendamiento(), deps.estadoModulo(), premiumDisponible()]);
      const v = calcularVentanas(prueba, ahora);
      const r = conPremium ? calcularVentanas(null, ahora) : null;

      // Un rango que cubre todas las ventanas: una consulta por tabla, repartida en memoria.
      const desde = new Date(Math.min(v.anterior.desde.getTime(), r ? r.anterior.desde.getTime() : Infinity));
      const hasta = new Date(Math.max(v.actual.hasta.getTime(), r ? r.actual.hasta.getTime() : -Infinity));
      const [citas, derivaciones, citasPeriodo] = await Promise.all([
        repo.citasIa(desde, hasta),
        repo.derivaciones(desde, hasta),
        r && repo.citasPeriodo ? repo.citasPeriodo(desde, hasta) : Promise.resolve([] as CitaMetrica[]),
      ]);

      const dto = (w: Ventana): ResumenVentana => ({
        desde: w.desde.toISOString(),
        hasta: w.hasta.toISOString(),
        ...resumir(w, citas, derivaciones, deps.esFueraDeHorario),
      });
      const premium = (w: Ventana): MetricasPremiumVentana => ({
        desde: w.desde.toISOString(),
        hasta: w.hasta.toISOString(),
        ...calcularPremium(w, ahora, citasPeriodo, derivaciones, deps.esFueraDeHorario, tarifas),
      });

      return {
        fuente: v.fuente,
        pruebaVigente: v.pruebaVigente,
        modulo,
        actual: dto(v.actual),
        anterior: dto(v.anterior),
        premium: r
          ? {
              moneda: tarifas.moneda,
              tarifasConfiguradas: Object.keys(tarifas.porEspecialidad).length > 0,
              actual: premium(r.actual),
              anterior: premium(r.anterior),
            }
          : null,
      };
    },
  };
}