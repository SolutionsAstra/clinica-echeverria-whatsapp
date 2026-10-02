/**
 * WorkspaceDashboard.jsx
 * Espacio de trabajo de recepción — Astra Health, Clínica Echeverría
 *
 *   ┌────────────┬──────────────────────────────┬──────────────┐
 *   │ Control    │ Bandeja de derivaciones      │ Próximas     │
 *   │ (reloj,    │ (vidrio sobre la red de      │ citas (≤ 3)  │
 *   │  red,      │  partículas)                 │              │
 *   │  sesión)   │                              │              │
 *   └────────────┴──────────────────────────────┴──────────────┘
 *   ≥ 2xl (1536): 3 columnas con scroll independiente.
 *   xl (1280–1535): control + una columna; las próximas citas van en fila sobre la bandeja.
 *   < xl: una columna; el control pasa a barra superior.
 *   La rejilla de filas de la bandeja necesita ≈ 960 px; estos cortes nunca la dejan por debajo.
 *
 * Contratos (backend en pg/Supabase):
 *   GET  /api/auth/me                      sesión + latido de red
 *   POST /api/auth/logout
 *   GET  /api/derivaciones                 SolicitudDto[]
 *   POST /api/derivaciones/:id/reservar    { inicio, doctorId? } → 201 ReservaResultado
 *   GET  /api/citas?estado=confirmada      CitaDetallada[]
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { listarDerivaciones, reservarDerivacion, RUTA_LOGIN } from "../../api/derivaciones";
import { cerrarSesion, listarCitasConfirmadas } from "../../api/panel";
import { useAhora } from "../../hooks/useAhora";
import { useEstadoRed } from "../../hooks/useEstadoRed";
import { useSondeo } from "../../hooks/useSondeo";
import AgendaAlertsPanel from "./workspace/AgendaAlertsPanel";
import ControlSidebar from "./workspace/ControlSidebar";
import DerivacionesColumn from "./workspace/DerivacionesColumn";
import MedicalNetworkBackground from "./workspace/MedicalNetworkBackground";
import { seleccionarProximasCitas } from "./workspace/agenda";
import { FUENTE } from "./workspace/tokens";

const SONDEO_DERIVACIONES_MS = 45000;
const SONDEO_AGENDA_MS = 60000;
const SIN_CITAS = [];
/** La derivación ya no está en la bandeja: se recarga tras dar tiempo a leer el aviso de la fila. */
const CODIGOS_DERIVACION_PERDIDA = new Set(["DERIVACION_NO_DISPONIBLE", "NOT_FOUND"]);
const ESPERA_ANTES_DE_RECARGAR_MS = 2500;

const cargarDerivaciones = (signal) => listarDerivaciones({ signal });
const cargarAgenda = (signal) => listarCitasConfirmadas({ signal });

export default function WorkspaceDashboard({ onSesionCerrada }) {
  const reservasEnCurso = useRef(0);
  const red = useEstadoRed();
  const ahora = useAhora(30000);

  const derivaciones = useSondeo(cargarDerivaciones, {
    intervaloMs: SONDEO_DERIVACIONES_MS,
    // No refrescar a mitad de una reserva: la derivación pasa a 'en_proceso' y la fila desaparecería.
    omitir: () => reservasEnCurso.current > 0,
  });
  const agenda = useSondeo(cargarAgenda, { intervaloMs: SONDEO_AGENDA_MS });

  const { tarjetas, restantesHoy } = useMemo(
    () => seleccionarProximasCitas(agenda.datos ?? SIN_CITAS, ahora),
    [agenda.datos, ahora],
  );

  const { recargar: recargarAgenda } = agenda;
  const { recargar: recargarDerivaciones } = derivaciones;

  /** onReservar(payload) de la bandeja → fetch real a POST /api/derivaciones/:id/reservar. */
  const reservar = useCallback(
    async (payload) => {
      reservasEnCurso.current += 1;
      try {
        const resultado = await reservarDerivacion(payload);
        recargarAgenda(); // la cita recién creada puede entrar en "Próximas citas"
        return resultado;
      } catch (err) {
        if (CODIGOS_DERIVACION_PERDIDA.has(err?.code)) {
          setTimeout(recargarDerivaciones, ESPERA_ANTES_DE_RECARGAR_MS);
        }
        throw err; // la bandeja muestra el mensaje según err.code
      } finally {
        reservasEnCurso.current -= 1;
      }
    },
    [recargarAgenda, recargarDerivaciones],
  );

  const [cierre, setCierre] = useState({ enCurso: false, error: null });
  const salir = useCallback(async () => {
    setCierre({ enCurso: true, error: null });
    try {
      await cerrarSesion();
    } catch {
      setCierre({ enCurso: false, error: "No se pudo cerrar la sesión. Revisa la conexión e intenta de nuevo." });
      return;
    }
    if (onSesionCerrada) onSesionCerrada();
    else window.location.assign(RUTA_LOGIN);
  }, [onSesionCerrada]);

  return (
    <div className={`relative min-h-dvh bg-[#0B192C] text-[#E6E9EE] antialiased ${FUENTE}`}>
      <MedicalNetworkBackground />

      <a
        href="#derivaciones"
        className="sr-only z-50 rounded-md bg-[#E6E9EE] px-3 py-2 text-sm text-[#0B192C] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Ir a la bandeja de derivaciones
      </a>

      <div className="relative z-10 grid min-h-dvh grid-cols-1 content-start xl:grid-cols-[14rem_minmax(0,1fr)] 2xl:h-dvh 2xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        {/* Columna 1 — control */}
        <aside
          aria-label="Control del panel"
          className="order-1 border-b border-[#1A2D48] bg-[#0B192C]/60 backdrop-blur-md xl:sticky xl:top-0 xl:order-none xl:row-span-2 xl:h-dvh xl:border-b-0 xl:border-r 2xl:row-span-1"
        >
          <ControlSidebar
            usuario={red.usuario}
            red={red}
            conteos={{ derivaciones: derivaciones.datos?.length ?? null, citasRestantes: agenda.datos ? restantesHoy : null }}
            onCerrarSesion={salir}
            cerrandoSesion={cierre.enCurso}
            errorCierre={cierre.error}
          />
        </aside>

        {/* Columna 2 — bandeja */}
        <main
          id="derivaciones"
          tabIndex={-1}
          className="order-3 min-w-0 scroll-mt-4 outline-none xl:order-none xl:col-start-2 xl:row-start-2 2xl:row-start-1 2xl:h-dvh 2xl:overflow-y-auto"
        >
          <DerivacionesColumn
            solicitudes={derivaciones.datos}
            cargando={derivaciones.cargando}
            error={derivaciones.error}
            actualizadoEn={derivaciones.actualizadoEn}
            onReintentar={recargarDerivaciones}
            onReservar={reservar}
          />
        </main>

        {/* Columna 3 — próximas citas */}
        <aside
          id="proximas-citas"
          aria-label="Próximas citas de hoy"
          className="order-2 min-w-0 border-b border-[#1A2D48] xl:order-none xl:col-start-2 xl:row-start-1 2xl:col-start-3 2xl:h-dvh 2xl:overflow-y-auto 2xl:border-b-0 2xl:border-l"
        >
          <AgendaAlertsPanel
            tarjetas={tarjetas}
            restantesHoy={restantesHoy}
            cargando={agenda.cargando}
            error={agenda.error}
            onReintentar={recargarAgenda}
          />
        </aside>
      </div>
    </div>
  );
}
