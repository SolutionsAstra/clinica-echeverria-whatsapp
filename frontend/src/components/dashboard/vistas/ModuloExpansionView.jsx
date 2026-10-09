/**
 * Vista de un módulo del catálogo de expansión de Astra Digital Solutions.
 *   Plan cargando              → esqueleto.
 *   Bloqueado (o sin dato)     → <BloqueoExpansion> sobre la silueta del módulo.
 *   En prueba o contratado     → estado del módulo y sus capacidades habilitadas.
 * El cambio bloqueado → habilitado es reactivo: depende solo de GET /api/plan (plan.datos).
 */
import { MODULO, TITULOS, estadoModulo } from "../plan/plan";
import { SUPERFICIE } from "../ui/estilos";
import { CargaVista, ContenedorVista, EncabezadoVista } from "../ui/Vista";
import { BloqueoExpansion } from "../workspace/BloqueoPremium";

/* ---------------- Siluetas (fondo atenuado del bloqueo: forma, nunca cifras) ---------------- */

function SiluetaFinanciera() {
  const barras = [40, 62, 48, 75, 58, 82, 66, 90, 72, 60, 78, 85];
  return (
    <div className="space-y-6 p-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${SUPERFICIE} p-6`}>
            <div className="h-3 w-28 rounded bg-[#1A2D48]" />
            <div className="mt-5 h-8 w-24 rounded bg-[#2A4266]" />
          </div>
        ))}
      </div>
      <div className={`${SUPERFICIE} flex h-48 items-end gap-3 p-6`}>
        {barras.map((alto, i) => (
          <div key={i} className="flex-1 rounded-sm bg-[#1A2D48]" style={{ height: `${alto}%` }} />
        ))}
      </div>
    </div>
  );
}

function SiluetaListaEspera() {
  return (
    <div className="space-y-6 p-8">
      <div className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-6 px-6 py-4">
            <div className="h-7 w-16 rounded-md border border-[#1A2D48]" />
            <div className="h-3 w-44 rounded bg-[#1A2D48]" />
            <div className="h-3 w-24 rounded bg-[#1A2D48]" />
            <div className="ml-auto h-6 w-20 rounded-md bg-[#12284A]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SiluetaReactivacion() {
  return (
    <div className="space-y-6 p-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={`${SUPERFICIE} p-6`}>
            <div className="h-3 w-24 rounded bg-[#1A2D48]" />
            <div className="mt-5 h-8 w-16 rounded bg-[#2A4266]" />
            <div className="mt-5 h-1.5 w-full rounded-full bg-[#1A2D48]" />
          </div>
        ))}
      </div>
      <div className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-8 px-6 py-4">
            <div className="h-3 w-40 rounded bg-[#1A2D48]" />
            <div className="h-3 w-28 rounded bg-[#1A2D48]" />
            <div className="ml-auto h-3 w-16 rounded bg-[#1A2D48]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Ficha de cada módulo ---------------- */

const FICHAS = {
  [MODULO.ANALITICA_FINANCIERA]: {
    descripcion: "Visión ejecutiva de ingresos y asistencia de la clínica, actualizada en tiempo real.",
    capacidades: ["Ganancias brutas", "Ingresos por especialista", "Tasa de asistencia vs. cancelaciones"],
    Silueta: SiluetaFinanciera,
  },
  [MODULO.LISTA_ESPERA_VIP]: {
    descripcion: "Cuando un paciente cancela con la agenda llena, la IA asigna la vacante a la lista de espera.",
    capacidades: ["Lista de espera para agendas llenas", "Asignación automática de vacantes liberadas por cancelación"],
    Silueta: SiluetaListaEspera,
  },
  [MODULO.REACTIVACION_DORMIDOS]: {
    descripcion: "Detecta pacientes sin actividad y los vuelve a contactar con una campaña por WhatsApp.",
    capacidades: ["Escaneo histórico de inactividad (3 o 6 meses)", "Campaña automatizada por WhatsApp"],
    Silueta: SiluetaReactivacion,
  },
};

const NOTA_ACTIVO = "Los datos de este módulo aparecerán aquí en cuanto su servicio quede conectado al panel.";

function EstadoActivo({ estado }) {
  const texto = estado.enPrueba
    ? `Prueba gratuita · ${estado.diasRestantes} ${estado.diasRestantes === 1 ? "día restante" : "días restantes"}`
    : "Incluido en el plan";
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[#243B5A] px-2.5 text-xs text-[#C7CCD3]">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#86D5BC]" />
      {texto}
    </span>
  );
}

function ModuloActivo({ ficha }) {
  return (
    <section aria-label="Capacidades del módulo" className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
      {ficha.capacidades.map((capacidad) => (
        <div key={capacidad} className="flex items-center justify-between gap-6 px-6 py-4">
          <span className="text-sm text-[#E6E9EE]">{capacidad}</span>
          <span className="inline-flex shrink-0 items-center gap-2 text-xs text-[#86D5BC]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#86D5BC]" />
            Habilitado
          </span>
        </div>
      ))}
      <p className="px-6 py-4 text-xs leading-relaxed text-[#7D8BA0]">{NOTA_ACTIVO}</p>
    </section>
  );
}

/**
 * @param {{ modulo: string, plan: { datos: object|null, error: unknown, recargar: () => void },
 *           ahora: number, rol: string }} props
 */
export default function ModuloExpansionView({ modulo, plan, ahora, rol }) {
  const ficha = FICHAS[modulo];
  const estado = estadoModulo(plan?.datos, modulo, ahora);
  const cargando = plan?.datos == null && plan?.error == null;
  const Silueta = ficha.Silueta;

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo={TITULOS[modulo]}
        descripcion={estado.habilitado ? ficha.descripcion : "Módulo de expansión de Astra Digital Solutions."}
      >
        {estado.habilitado && <EstadoActivo estado={estado} />}
      </EncabezadoVista>

      {cargando ? (
        <CargaVista filas={4} />
      ) : estado.habilitado ? (
        <ModuloActivo ficha={ficha} />
      ) : (
        <BloqueoExpansion
          modulo={modulo}
          plan={plan}
          rol={rol}
          ahora={ahora}
          titulo="Módulo no incluido en el plan actual"
          vistaPrevia={<Silueta />}
        />
      )}
    </ContenedorVista>
  );
}