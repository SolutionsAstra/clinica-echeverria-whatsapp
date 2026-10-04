import {
  MENSAJE_MODULO,
  PlanError,
  calcularEstadoPlan,
  crearPrueba,
  verificarCupoOperador,
  type Contrato,
  type EstadoPlan,
  type Modulo,
  type Prueba,
} from "../domain/plan";

export interface PlanRepository {
  leerContrato(): Promise<Contrato>;
  /** Usuarios con activo = TRUE (todos los roles cuentan como operador). */
  contarOperadoresActivos(): Promise<number>;
  listarPruebas(): Promise<Prueba[]>;
  /** false si otra petición ya registró la prueba de ese módulo (PK por módulo). */
  registrarPrueba(prueba: Prueba, usuarioId: number | null): Promise<boolean>;
}

export interface PlanService {
  estado(): Promise<EstadoPlan>;
  exigirModulo(modulo: Modulo): Promise<void>;
  exigirCupoOperador(): Promise<void>;
  iniciarPrueba(modulo: unknown, usuarioId: number | null): Promise<EstadoPlan>;
}

export function createPlanService({
  repository,
  reloj = () => new Date(),
}: {
  repository: PlanRepository;
  reloj?: () => Date;
}): PlanService {
  async function estado(): Promise<EstadoPlan> {
    const [contrato, pruebas, activos] = await Promise.all([
      repository.leerContrato(),
      repository.listarPruebas(),
      repository.contarOperadoresActivos(),
    ]);
    return calcularEstadoPlan(contrato, pruebas, activos, reloj());
  }

  return {
    estado,

    async exigirModulo(modulo) {
      const e = await estado();
      if (!e.modulos[modulo].habilitado) throw new PlanError("MODULO_PREMIUM", MENSAJE_MODULO[modulo], modulo);
    },

    /**
     * Comprobación previa para dar un mensaje claro. La garantía real (sin carreras entre dos
     * altas simultáneas) es el trigger de la migración, que serializa con un advisory lock.
     */
    async exigirCupoOperador() {
      const [contrato, activos] = await Promise.all([repository.leerContrato(), repository.contarOperadoresActivos()]);
      verificarCupoOperador(activos, contrato.maxOperadores);
    },

    async iniciarPrueba(modulo, usuarioId) {
      const [contrato, pruebas] = await Promise.all([repository.leerContrato(), repository.listarPruebas()]);
      const prueba = crearPrueba(modulo, contrato, pruebas, reloj());
      const registrada = await repository.registrarPrueba(prueba, usuarioId);
      if (!registrada) {
        throw new PlanError("PRUEBA_NO_DISPONIBLE", "La prueba gratuita de este módulo ya se usó o no está disponible.", prueba.modulo);
      }
      return estado();
    },
  };
}
