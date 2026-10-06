/**
 * AdminDashboard.jsx — Panel unificado de Astra Health para Clínica Echeverría.
 * Reemplaza a WorkspaceDashboard y al panel legado de public/admin (Citas, Doctores, Reportes,
 * Escaladas, Usuarios) con el sistema "UI/UX Pro Max".
 *
 *   ┌───────────────┬───────────────────────────────────────────────┐
 *   │ ControlSidebar│  Vista activa (scroll propio)                 │
 *   │ 15 rem, fijo  │  max-w 96 rem, alineada a la izquierda        │
 *   └───────────────┴───────────────────────────────────────────────┘
 *   ≥ xl (1280): dos columnas.  < xl: el menú pasa a barra superior con desplazamiento horizontal.
 *   Fondo: MedicalNetworkBackground (Canvas) detrás de todo, en #0B192C.
 *
 * Datos compartidos entre vistas (un solo sondeo por recurso):
 *   GET /api/plan           cada 5 min   → candados premium
 *   GET /api/citas          cada 60 s    → Citas, calendario, próximas de hoy, ausentismo
 *   GET /api/doctores       al entrar    → calendario, usuarios
 *   GET /api/derivaciones   cada 45 s    → bandeja y cola por doctor (solo recepción/dirección)
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { listarDerivaciones, reservarDerivacion, RUTA_LOGIN } from "../../api/derivaciones";
import { cerrarSesion, listarCitas, listarDoctores, obtenerPlan } from "../../api/panel";
import { useAhora } from "../../hooks/useAhora";
import { useEstadoRed } from "../../hooks/useEstadoRed";
import { useSondeo } from "../../hooks/useSondeo";
import { MODULO, esBloqueoPremium, estadoModulo } from "./plan/plan";
import { ProveedorPlan } from "./plan/ContextoPlan";
import ControlSidebar from "./workspace/ControlSidebar";
import MedicalNetworkBackground from "./workspace/MedicalNetworkBackground";
import { FUENTE } from "./workspace/tokens";
import CitasView from "./vistas/CitasView";
import DerivacionesView from "./vistas/DerivacionesView";
import DoctoresView from "./vistas/DoctoresView";
import EscaladasView from "./vistas/EscaladasView";
import ReportesView from "./vistas/ReportesView";
import ResumenView from "./vistas/ResumenView";
import UsuariosView from "./vistas/UsuariosView";

const TODOS = ["recepcion", "direccion", "doctor"];
const OPERACION = ["recepcion", "direccion"];

/** Orden y permisos del menú. Reportes queda visible para todos: muestra su pantalla premium. */
const SECCIONES = [
  { id: "resumen", etiqueta: "Resumen", roles: TODOS },
  { id: "derivaciones", etiqueta: "Derivaciones IA", roles: OPERACION },
  { id: "citas", etiqueta: "Citas", roles: TODOS },
  { id: "doctores", etiqueta: "Doctores y horarios", roles: TODOS },
  { id: "reportes", etiqueta: "Reportes", roles: TODOS, modulo: MODULO.REPORTES },
  { id: "escaladas", etiqueta: "Escaladas", roles: OPERACION },
  { id: "usuarios", etiqueta: "Usuarios", roles: ["direccion"] },
];

const SONDEO_PLAN_MS = 5 * 60_000;
const SONDEO_CITAS_MS = 60_000;
const SONDEO_DERIVACIONES_MS = 45_000;
/** La derivación ya no está en la bandeja: se recarga tras dar tiempo a leer el aviso de la fila. */
const CODIGOS_DERIVACION_PERDIDA = new Set(["DERIVACION_NO_DISPONIBLE", "NOT_FOUND"]);
const ESPERA_ANTES_DE_RECARGAR_MS = 2500;

const cargarPlan = (signal) => obtenerPlan({ signal });
const cargarCitas = (signal) => listarCitas({ signal });
const cargarDoctores = (signal) => listarDoctores({ signal });

function vistaInicial(rol) {
  const permitidas = SECCIONES.filter((s) => s.roles.includes(rol)).map((s) => s.id);
  const pedida = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  if (permitidas.includes(pedida)) return pedida;
  return rol === "recepcion" ? "derivaciones" : "resumen";
}

export default function AdminDashboard({ usuarioInicial, onSesionCerrada }) {
  const red = useEstadoRed();
  const usuario = red.usuario ?? usuarioInicial ?? null;
  const rol = usuario?.rol ?? usuarioInicial?.rol;
  const ahora = useAhora(30000);
  const principal = useRef(null);
  const reservasEnCurso = useRef(0);
  const [vista, setVista] = useState(() => vistaInicial(usuarioInicial?.rol));

  const puedeOperar = OPERACION.includes(rol);
  const cargarDerivaciones = useCallback(
    (signal) => (puedeOperar ? listarDerivaciones({ signal }) : Promise.resolve([])),
    [puedeOperar],
  );

  const plan = useSondeo(cargarPlan, { intervaloMs: SONDEO_PLAN_MS });
  const citas = useSondeo(cargarCitas, { intervaloMs: SONDEO_CITAS_MS });
  const doctores = useSondeo(cargarDoctores);
  const derivaciones = useSondeo(cargarDerivaciones, {
    intervaloMs: SONDEO_DERIVACIONES_MS,
    // No refrescar a mitad de una reserva: la derivación pasa a 'en_proceso' y la fila desaparecería.
    omitir: () => reservasEnCurso.current > 0,
  });

  const { recargar: recargarCitas } = citas;
  const { recargar: recargarDerivaciones } = derivaciones;

  /** onReservar(payload) de la bandeja → POST /api/derivaciones/:id/reservar (notifica por WhatsApp). */
  const reservar = useCallback(
    async (payload) => {
      reservasEnCurso.current += 1;
      try {
        const resultado = await reservarDerivacion(payload);
        recargarCitas(); // la cita nueva aparece en próximas, calendario y tabla
        return resultado;
      } catch (err) {
        if (CODIGOS_DERIVACION_PERDIDA.has(err?.code)) setTimeout(recargarDerivaciones, ESPERA_ANTES_DE_RECARGAR_MS);
        throw err; // la bandeja muestra el mensaje según err.code
      } finally {
        reservasEnCurso.current -= 1;
      }
    },
    [recargarCitas, recargarDerivaciones],
  );

  const secciones = useMemo(
    () =>
      SECCIONES.filter((s) => s.roles.includes(rol)).map((s) => {
        const e = s.modulo ? estadoModulo(plan.datos, s.modulo, ahora) : null;
                // Un 403 MODULO_PREMIUM de la bandeja también es un candado, aunque el plan aún no lo liste.
        const bandejaBloqueada = s.id === "derivaciones" && esBloqueoPremium(derivaciones.error);
        return {
          id: s.id,
          etiqueta: s.etiqueta,
          bloqueada: Boolean(e?.conocido && !e.habilitado) || bandejaBloqueada,
          cuenta: s.id === "derivaciones" && !bandejaBloqueada ? (derivaciones.datos?.length ?? null) : null,
        };
      }),
    [rol, plan.datos, ahora, derivaciones.datos, derivaciones.error],
  );
  const vistaActiva = secciones.some((s) => s.id === vista) ? vista : (secciones[0]?.id ?? "resumen");

  const navegar = useCallback((id) => {
    setVista(id);
    window.history.replaceState(null, "", `#${id}`);
    // Lleva el foco al título de la nueva vista (lector de pantalla y teclado) y vuelve arriba.
    requestAnimationFrame(() => {
      principal.current?.scrollTo({ top: 0 });
      const destino = principal.current?.querySelector("#titulo-vista") ?? principal.current;
      destino?.focus({ preventScroll: true });
    });
  }, []);

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
  const contextoPlan = { plan, rol, ahora };
  let contenido;
  switch (vistaActiva) {
    case "derivaciones":
            contenido = (
        <DerivacionesView
          derivaciones={derivaciones}
          citas={citas}
          plan={plan}
          ahora={ahora}
          rol={rol}
          onReservar={reservar}
        />
      );
      break;
    case "citas":
      contenido = <CitasView citas={citas} plan={plan} ahora={ahora} rol={rol} />;
      break;
    case "doctores":
      contenido = (
        <DoctoresView
          doctores={doctores}
          citas={citas}
          derivaciones={derivaciones}
          plan={plan}
          ahora={ahora}
          usuario={usuario}
          onIrADerivaciones={() => navegar("derivaciones")}
        />
      );
      break;
    case "reportes":
      contenido = <ReportesView plan={plan} citas={citas} ahora={ahora} rol={rol} />;
      break;
    case "escaladas":
      contenido = <EscaladasView />;
      break;
    case "usuarios":
      contenido = <UsuariosView plan={plan} doctores={doctores} usuarioActual={usuario} />;
      break;
    default:
      contenido = <ResumenView rol={rol} citas={citas.datos} plan={plan} ahora={ahora} />;
  }

  return (
    <div className={`relative min-h-dvh bg-[#0B192C] text-[#E6E9EE] antialiased ${FUENTE}`}>
      <MedicalNetworkBackground />

      <a
        href="#principal"
        className="sr-only z-50 rounded-md bg-[#E6E9EE] px-3 py-2 text-sm text-[#0B192C] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Ir al contenido
      </a>

      <div className="relative z-10 grid min-h-dvh grid-cols-1 content-start xl:h-dvh xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          aria-label="Menú del panel"
          className="border-b border-[#1A2D48] bg-[#0B192C]/60 backdrop-blur-md xl:h-dvh xl:overflow-y-auto xl:border-b-0 xl:border-r"
        >
          <ControlSidebar
            usuario={usuario}
            red={red}
            secciones={secciones}
            activa={vistaActiva}
            onNavegar={navegar}
            onCerrarSesion={salir}
            cerrandoSesion={cierre.enCurso}
            errorCierre={cierre.error}
          />
        </aside>

        <main id="principal" ref={principal} tabIndex={-1} className="min-w-0 outline-none xl:h-dvh xl:overflow-y-auto">
          {contenido}
        </main>
      </div>
    </div>
  );
}
