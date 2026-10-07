/**
 * Reportes — módulo premium de Dirección.
 *   Bloqueado (plan, 403 MODULO_PREMIUM o premium: null en /api/impacto-ia) → <BloqueoPremium>
 *     con las tres métricas premium listadas.
 *   En prueba (7 días) o contratado → tarjetas premium + ausentismo por doctor + historial de envíos.
 * Un 403 MODULO_PREMIUM es una respuesta comercial: nunca termina en "No se pudo cargar esta sección".
 */
import { useCallback, useMemo, useState } from "react";
import { Banknote, Clock, Loader2, MessagesSquare, UserX } from "lucide-react";
import { obtenerImpactoIa } from "../../../api/impactoIa";
import { generarReporteAhora, listarReportes, textoDeError } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { MODULO, diasPruebaDe, esBloqueoPremium, estadoModulo } from "../plan/plan";
import { ausentismoPorDoctor } from "../reportes/ausentismo";
import MetricasPremium from "../reportes/MetricasPremium";
import { BOTON_SECUNDARIO, FILA, SUPERFICIE, TABLA, TD, TH } from "../ui/estilos";
import { fechaHora, fechaLarga } from "../ui/formato";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado, VacioVista } from "../ui/Vista";
import BloqueoPremium from "../workspace/BloqueoPremium";

const SONDEO_IMPACTO_MS = 5 * 60_000;
const cargarImpacto = (signal) => obtenerImpactoIa({ signal });

const MENSAJE_BLOQUEO =
  "Módulo Premium Activo en Plan Corporativo. Consulte a Soluciones Astra para habilitar las tres métricas avanzadas de Dirección:";

const METRICAS_BLOQUEADAS = [
  {
    Icono: UserX,
    nombre: "Analítica Avanzada de Ausentismo (Pacientes Inasistentes)",
    apoyo: "Tasa por especialidad y por doctor, comparada semana contra semana.",
  },
  {
    Icono: MessagesSquare,
    nombre: "Tasa de Conversión Conversacional de la IA",
    apoyo: "Cuántas solicitudes por WhatsApp terminan en cita confirmada.",
  },
  {
    Icono: Banknote,
    nombre: "Reporte de Ingresos Proyectados Fuera de Horario Laboral",
    apoyo: "El valor de las citas que la IA agenda con la recepción cerrada.",
  },
];

function ListaMetricasBloqueadas() {
  return (
    <ul className="divide-y divide-[#1A2D48] rounded-lg border border-[#1A2D48] bg-[#0B192C]/40">
      {METRICAS_BLOQUEADAS.map(({ Icono, nombre, apoyo }) => (
        <li key={nombre} className="flex items-start gap-3 px-4 py-3.5">
          <Icono aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#A3AEBD]" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#E6E9EE]">{nombre}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[#7D8BA0]">{apoyo}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Silueta del módulo para el fondo del bloqueo: tres tarjetas y filas, sin cifras reales. */
function VistaPrevia() {
  return (
    <div className="space-y-6 p-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${SUPERFICIE} p-6`}>
            <div className="h-4 w-40 rounded bg-[#1A2D48]" />
            <div className="mt-6 h-9 w-20 rounded bg-[#2A4266]" />
            <div className="mt-6 space-y-3 border-t border-[#1A2D48] pt-4">
              {[72, 48, 30].map((ancho) => (
                <div key={ancho} className="h-1.5 rounded-full bg-[#2A4266]" style={{ width: `${ancho}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-8 px-6 py-4">
            <div className="h-3 w-40 rounded bg-[#1A2D48]" />
            <div className="h-3 w-32 rounded bg-[#1A2D48]" />
            <div className="ml-auto h-3 w-16 rounded bg-[#1A2D48]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function BloqueoReportes({ plan, ahora, rol, onActivada }) {
  const e = estadoModulo(plan.datos, MODULO.REPORTES, ahora);
  return (
    <BloqueoPremium
      titulo="Reportes Premium de Dirección"
      mensaje={MENSAJE_BLOQUEO}
      detalle={<ListaMetricasBloqueadas />}
      modulo={MODULO.REPORTES}
      rol={rol}
      pruebaDisponible={e.conocido ? e.pruebaDisponible : null}
      diasPrueba={diasPruebaDe(plan.datos, MODULO.REPORTES)}
      vistaPrevia={<VistaPrevia />}
      onActivada={onActivada}
    />
  );
}

function Ausentismo({ citas, ahora }) {
  const filas = useMemo(() => ausentismoPorDoctor(citas, ahora), [citas, ahora]);
  return (
    <section aria-labelledby="ausentismo-titulo" className={`${SUPERFICIE} p-6`}>
      <h2 id="ausentismo-titulo" className="text-base font-semibold text-[#E6E9EE]">
        Tasa de Ausentismo por doctor
      </h2>
      <p className="mt-1 text-sm text-[#A3AEBD]">Porcentaje de citas ya ocurridas en las que el paciente no se presentó.</p>
      {filas.length === 0 ? (
        <VacioVista titulo="Aún no hay citas ocurridas para medir." />
      ) : (
        <ul className="mt-6 space-y-4">
          {filas.map((f) => (
            <li key={f.doctorId} className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_13rem] sm:items-center sm:gap-4">
              <span className="truncate text-sm text-[#E6E9EE]">{f.doctor}</span>
              <span aria-hidden className="h-1.5 rounded-full bg-[#1A2D48]">
                <span className="block h-full rounded-full bg-[#C9AE72]" style={{ width: `${f.tasa}%` }} />
              </span>
              <span className="text-sm tabular-nums text-[#C7CCD3] sm:text-right">
                {f.tasa}%{" "}
                <span className="text-[#7D8BA0]">
                  ({f.noShow} de {f.ocurridas} {f.noShow === 1 ? "paciente inasistente" : "pacientes inasistentes"})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistorialEnvios({ reportes }) {
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const generar = async () => {
    setGenerando(true);
    setResultado(null);
    try {
      await generarReporteAhora();
      setResultado({ tipo: "ok", texto: "Reporte generado y enviado a cada doctor con citas hoy." });
      reportes.recargar();
    } catch (err) {
      setResultado({ tipo: "error", texto: textoDeError(err) });
    } finally {
      setGenerando(false);
    }
  };

  return (
    <section aria-labelledby="envios-titulo">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="envios-titulo" className="text-base font-semibold text-[#E6E9EE]">
          Reportes enviados por correo
        </h2>
        <div className="flex items-center gap-4">
          <Resultado resultado={resultado} />
          <button type="button" onClick={generar} disabled={generando} className={BOTON_SECUNDARIO}>
            {generando && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {generando ? "Generando…" : "Generar y enviar ahora"}
          </button>
        </div>
      </div>
      <div className={`${SUPERFICIE} overflow-x-auto`}>
        <table className={TABLA}>
          <thead>
            <tr>
              <th scope="col" className={TH}>Doctor</th>
              <th scope="col" className={TH}>Generado</th>
              <th scope="col" className={TH}>Envío</th>
            </tr>
          </thead>
          <tbody>
            {reportes.datos.map((r) => (
              <tr key={r.id} className={FILA}>
                <td className={TD}>{r.doctor_nombre}</td>
                <td className={`${TD} capitalize tabular-nums text-[#C7CCD3]`}>{fechaHora(r.fecha_generacion)}</td>
                <td className={TD}>
                  {r.estado_envio === "enviado" ? (
                    <span className="text-[#86D5BC]">Enviado</span>
                  ) : (
                    <span className="text-[#E8A9A9]">Fallido</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reportes.datos.length === 0 && <VacioVista titulo="Aún no se ha enviado ningún reporte." />}
      </div>
    </section>
  );
}

/** Dirección con el módulo activo (o sin dato del plan): el servidor tiene la última palabra. */
function ModuloReportes({ plan, citas, ahora, rol }) {
  const { recargar: recargarPlan } = plan;
  const cargarReportes = useCallback(
    (signal) =>
      listarReportes({ signal }).catch((err) => {
        if (esBloqueoPremium(err)) recargarPlan(); // el plan quedó desactualizado: refresca el candado del menú
        throw err;
      }),
    [recargarPlan],
  );
  const reportes = useSondeo(cargarReportes);
  const impacto = useSondeo(cargarImpacto, { intervaloMs: SONDEO_IMPACTO_MS });

  const recargarTodo = () => {
    plan.recargar();
    reportes.recargar();
    impacto.recargar();
  };

  if (reportes.cargando && !reportes.datos && impacto.cargando && !impacto.datos) return <CargaVista filas={4} />;

  // 403 en /api/reportes o premium: null en /api/impacto-ia = el servidor dice que el módulo está cerrado.
  if (esBloqueoPremium(reportes.error) || impacto.datos?.premium === null) {
    return <BloqueoReportes plan={plan} ahora={ahora} rol={rol} onActivada={recargarTodo} />;
  }

  let historial;
  if (reportes.cargando && !reportes.datos) historial = <CargaVista filas={3} />;
  else if (reportes.error && !reportes.datos) {
    historial = (
      <ErrorVista titulo="No se pudo cargar el historial de envíos." error={reportes.error} onReintentar={reportes.recargar} />
    );
  } else historial = <HistorialEnvios reportes={reportes} />;

  return (
    <div className="space-y-10">
      <MetricasPremium impacto={impacto} />
      <Ausentismo citas={citas.datos} ahora={ahora} />
      {historial}
    </div>
  );
}

export default function ReportesView({ plan, citas, ahora, rol }) {
  const reportes = estadoModulo(plan.datos, MODULO.REPORTES, ahora);
  const esDireccion = rol === "direccion";

  let contenido;
  if (!reportes.conocido && plan.cargando) {
    contenido = <CargaVista filas={4} />;
  } else if (reportes.conocido && !reportes.habilitado) {
    contenido = <BloqueoReportes plan={plan} ahora={ahora} rol={rol} onActivada={plan.recargar} />;
  } else if (!esDireccion) {
    contenido = reportes.habilitado ? (
      <div className={`${SUPERFICIE} px-6 py-10`}>
        <p className="text-sm font-medium text-[#E6E9EE]">Los reportes los consulta Dirección.</p>
        <p className="mt-1 text-sm text-[#A3AEBD]">El módulo está activo para la clínica; el detalle es de acceso restringido.</p>
      </div>
    ) : (
      // Sin dato del plan y sin acceso a /api/reportes: se muestra el bloqueo, no un error.
      <BloqueoReportes plan={plan} ahora={ahora} rol={rol} onActivada={plan.recargar} />
    );
  } else {
    contenido = <ModuloReportes plan={plan} citas={citas} ahora={ahora} rol={rol} />;
  }

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Reportes"
        descripcion="Tasa de Ausentismo, conversión de la IA e ingresos proyectados fuera de horario, más los reportes diarios enviados a cada especialista."
      >
        {reportes.enPrueba && (
          <p role="status" className="inline-flex items-center gap-2 rounded-md border border-[#4A4230] px-3 py-2 text-sm text-[#C9AE72]">
            <Clock aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            Prueba gratuita: {reportes.diasRestantes === 1 ? "queda 1 día" : `quedan ${reportes.diasRestantes} días`}
            <span className="text-[#7D8BA0]">(hasta el {fechaLarga(plan.datos.modulos.reportes.pruebaExpiraEn)})</span>
          </p>
        )}
      </EncabezadoVista>
      {contenido}
    </ContenedorVista>
  );
}