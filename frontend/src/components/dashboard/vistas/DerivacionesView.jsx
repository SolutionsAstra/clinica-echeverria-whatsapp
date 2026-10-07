/**
 * Bandeja de derivaciones del agente IA 24/7 + próximas citas de hoy.
 *
 *   ≥ 2xl: bandeja | próximas citas (20 rem, scroll propio)
 *   <  2xl: próximas citas en fila sobre la bandeja
 *
 * Si /api/derivaciones responde 403 MODULO_PREMIUM, la bandeja muestra el bloqueo comercial
 * (vidrio + candado + "Probar Gratis por 3 días"); las próximas citas siguen visibles.
 */
import { useMemo } from "react";
import { textoDeError } from "../../../api/panel";
import { ContenedorVista, EncabezadoVista } from "../ui/Vista";
import AgendaAlertsPanel from "../workspace/AgendaAlertsPanel";
import BloqueoPremium from "../workspace/BloqueoPremium";
import DerivacionesColumn from "../workspace/DerivacionesColumn";
import { seleccionarProximasCitas } from "../workspace/agenda";
import { MENSAJES, MODULO, diasPruebaDe, esBloqueoPremium, estadoModulo } from "../plan/plan";

const SIN_CITAS = [];
const MENSAJE_BANDEJA =
  "La bandeja del agente IA no está incluida en el plan de la clínica. Consulte a Soluciones Astra para habilitarla.";

/** Forma de la bandeja para el fondo del bloqueo, sin datos reales. */
function SiluetaBandeja() {
  return (
    <div className="divide-y divide-[#1A2D48] overflow-hidden rounded-[10px] border border-[#1A2D48] bg-[#0E1F36]/90">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-8 px-6 py-5">
          <div className="h-3 w-40 rounded bg-[#1A2D48]" />
          <div className="h-3 w-28 rounded bg-[#1A2D48]" />
          <div className="h-5 w-24 rounded-full border border-[#1A2D48]" />
          <div className="ml-auto h-8 w-32 rounded-md bg-[#1A2D48]" />
        </div>
      ))}
    </div>
  );
}

export default function DerivacionesView({ derivaciones, citas, plan, ahora, rol, onReservar }) {
  const { tarjetas, restantesHoy } = useMemo(
    () => seleccionarProximasCitas(citas.datos ?? SIN_CITAS, ahora),
    [citas.datos, ahora],
  );

  const notificaciones = estadoModulo(plan.datos, MODULO.NOTIFICACIONES, ahora);
  const bloqueo = esBloqueoPremium(derivaciones.error) ? derivaciones.error : null;
  const modulo = bloqueo?.modulo ?? null;
  const estadoBloqueo = modulo ? estadoModulo(plan.datos, modulo, ahora) : null;

  return (
    <div className="grid min-h-full grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section
        id="derivaciones"
        aria-label="Bandeja de derivaciones"
        className="order-2 min-w-0 2xl:order-none 2xl:h-dvh 2xl:overflow-y-auto"
      >
        {bloqueo ? (
          <ContenedorVista>
            <EncabezadoVista
              id="titulo-vista"
              titulo="Derivaciones del agente IA"
              descripcion="Solicitudes que el asistente de WhatsApp recibe las 24 horas, para agendarlas por orden de llegada."
            />
            <BloqueoPremium
              titulo="Bandeja de derivaciones del agente IA"
              mensaje={(modulo && MENSAJES[modulo]) || textoDeError(bloqueo, MENSAJE_BANDEJA)}
              modulo={modulo}
              rol={rol}
              pruebaDisponible={estadoBloqueo?.conocido ? estadoBloqueo.pruebaDisponible : null}
              diasPrueba={diasPruebaDe(plan.datos, modulo)}              vistaPrevia={<SiluetaBandeja />}
              onActivada={() => {
                plan.recargar();
                derivaciones.recargar();
              }}
            />
          </ContenedorVista>
        ) : (
          <DerivacionesColumn
            solicitudes={derivaciones.datos}
            cargando={derivaciones.cargando}
            error={derivaciones.error}
            actualizadoEn={derivaciones.actualizadoEn}
            onReintentar={derivaciones.recargar}
            onReservar={onReservar}
          />
        )}
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
          notificacionesHabilitadas={notificaciones.habilitado}
        />
      </aside>
    </div>
  );
}