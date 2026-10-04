/**
 * Bandeja de derivaciones del agente IA 24/7 + próximas citas de hoy.
 * Absorbe lo que antes hacía WorkspaceDashboard (columnas 2 y 3); el menú vive ahora en el shell.
 *
 *   ≥ 2xl: bandeja | próximas citas (20 rem, scroll propio)
 *   <  2xl: próximas citas en fila sobre la bandeja
 */
import { useMemo } from "react";
import AgendaAlertsPanel from "../workspace/AgendaAlertsPanel";
import DerivacionesColumn from "../workspace/DerivacionesColumn";
import { seleccionarProximasCitas } from "../workspace/agenda";

const SIN_CITAS = [];

export default function DerivacionesView({ derivaciones, citas, ahora, onReservar }) {
  const { tarjetas, restantesHoy } = useMemo(
    () => seleccionarProximasCitas(citas.datos ?? SIN_CITAS, ahora),
    [citas.datos, ahora],
  );

  return (
    <div className="grid min-h-full grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section
        id="derivaciones"
        aria-label="Bandeja de derivaciones"
        className="order-2 min-w-0 2xl:order-none 2xl:h-dvh 2xl:overflow-y-auto"
      >
        <DerivacionesColumn
          solicitudes={derivaciones.datos}
          cargando={derivaciones.cargando}
          error={derivaciones.error}
          actualizadoEn={derivaciones.actualizadoEn}
          onReintentar={derivaciones.recargar}
          onReservar={onReservar}
        />
      </section>

      <aside
        id="proximas-citas"
        aria-label="Próximas citas de hoy"
        className="order-1 min-w-0 border-b border-[#1A2D48] 2xl:order-none 2xl:h-dvh 2xl:overflow-y-auto 2xl:border-b-0 2xl:border-l"
      >
        <AgendaAlertsPanel
          tarjetas={tarjetas}
          restantesHoy={restantesHoy}
          cargando={citas.cargando}
          error={citas.error}
          onReintentar={citas.recargar}
        />
      </aside>
    </div>
  );
}
