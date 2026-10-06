import { calcularVentanas, resumir, type DerivacionMetrica, type Fuente, type PruebaFechas, type Resumen, type Ventana } from "../domain/impacto";

export interface ImpactoRepository {
  /** creado_en de citas con origen 'ia' no canceladas, en [desde, hasta). */
  citasIa(desde: Date, hasta: Date): Promise<Date[]>;
  derivaciones(desde: Date, hasta: Date): Promise<DerivacionMetrica[]>;
}

export interface EstadoModuloIa {
  habilitado: boolean;
  origen: "contrato" | "prueba" | null;
  pruebaExpiraEn: string | null;
}

export type ResumenVentana = Resumen & { desde: string; hasta: string };

/** Contrato EXACTO de GET /api/impacto-ia. */
export interface ImpactoIaDto {
  fuente: Fuente;
  pruebaVigente: boolean;
  modulo: EstadoModuloIa;
  actual: ResumenVentana;
  anterior: ResumenVentana;
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
  reloj?: () => Date;
}): ImpactoIaService {
  const reloj = deps.reloj ?? (() => new Date());

  return {
    async resumen() {
      const ahora = reloj();
      const [prueba, modulo] = await Promise.all([deps.pruebaAgendamiento(), deps.estadoModulo()]);
      const v = calcularVentanas(prueba, ahora);
      // Una consulta por tabla para ambos periodos; se reparte en memoria.
      const [citas, derivaciones] = await Promise.all([
        deps.repository.citasIa(v.anterior.desde, v.actual.hasta),
        deps.repository.derivaciones(v.anterior.desde, v.actual.hasta),
      ]);
      const dto = (w: Ventana): ResumenVentana => ({
        desde: w.desde.toISOString(),
        hasta: w.hasta.toISOString(),
        ...resumir(w, citas, derivaciones, deps.esFueraDeHorario),
      });
      return { fuente: v.fuente, pruebaVigente: v.pruebaVigente, modulo, actual: dto(v.actual), anterior: dto(v.anterior) };
    },
  };
}