/**
 * Reportes — módulo premium.
 *   Bloqueado según el plan, o por un 403 MODULO_PREMIUM del servidor → <BloqueoPremium>.
 *   En prueba  → aviso con los días restantes + el módulo completo.
 *   Contratado → el módulo completo.
 * Un 403 MODULO_PREMIUM es una respuesta comercial, no un fallo de carga: nunca termina en
 * "No se pudo cargar esta sección". Si /api/plan no responde, decide /api/reportes.
 */
import { useCallback, useMemo, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { generarReporteAhora, listarReportes, textoDeError } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { MENSAJES, MODULO, esBloqueoPremium, estadoModulo } from "../plan/plan";
import { ausentismoPorDoctor } from "../reportes/ausentismo";
import { BOTON_SECUNDARIO, FILA, SUPERFICIE, TABLA, TD, TH } from "../ui/estilos";
import { fechaHora, fechaLarga } from "../ui/formato";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado, VacioVista } from "../ui/Vista";
import BloqueoPremium from "../workspace/BloqueoPremium";
import { MENSAJES, MODULO, diasPruebaDe, esBloqueoPremium, estadoModulo } from "../plan/plan";
/** Silueta del módulo para el fondo del bloqueo: barras y filas sin cifras reales. */
function VistaPrevia() {
  const barras = [72, 48, 30, 18];
  return (
    <div className="space-y-6 p-8">
      <div className={`${SUPERFICIE} p-6`}>
        <div className="h-4 w-56 rounded bg-[#1A2D48]" />
        <div className="mt-6 space-y-4">
          {barras.map((ancho) => (
            <div key={ancho} className="flex items-center gap-4">
              <div className="h-3 w-28 rounded bg-[#1A2D48]" />
              <div className="h-2.5 rounded-full bg-[#2A4266]" style={{ width: `${ancho}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className={`${SUPERFICIE} divide-y divide-[#1A2D48]`}>
        {[0, 1, 2, 3, 4].map((i) => (
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
      titulo="Analítica avanzada de ausentismo"
      mensaje={MENSAJES[MODULO.REPORTES]}
      modulo={MODULO.REPORTES}
      rol={rol}
      pruebaDisponible={e.conocido ? e.pruebaDisponible : null}
      diasPrueba={diasPruebaDe(plan.datos, MODULO.REPORTES)}      vistaPrevia={<VistaPrevia />}
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
      <p className="mt-1 text-sm text-[#A3AEBD]">
        Porcentaje de citas ya ocurridas en las que el paciente no se presentó.
      </p>
      {filas.length === 0 ? (
        <VacioVista titulo="Aún no hay citas ocurridas para medir." />
      ) : (
        <ul className="mt-6 space-y-4">
          {filas.map((f) => (
            <li key={f.doctorId} className="grid grid-cols-[12rem_minmax(0,1fr)_11rem] items-center gap-4">
              <span className="truncate text-sm text-[#E6E9EE]">{f.doctor}</span>
              <span aria-hidden className="h-1.5 rounded-full bg-[#1A2D48]">
                <span className="block h-full rounded-full bg-[#C9AE72]" style={{ width: `${f.tasa}%` }} />
              </span>
              <span className="text-right text-sm tabular-nums text-[#C7CCD3]">
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
  const cargar = useCallback(
    (signal) =>
      listarReportes({ signal }).catch((err) => {
        if (esBloqueoPremium(err)) recargarPlan(); // el plan quedó desactualizado: refresca el candado del menú
        throw err;
      }),
    [recargarPlan],
  );
  const reportes = useSondeo(cargar);

  if (reportes.cargando && !reportes.datos) return <CargaVista filas={4} />;

  if (esBloqueoPremium(reportes.error)) {
    return (
      <BloqueoReportes
        plan={plan}
        ahora={ahora}
        rol={rol}
        onActivada={() => {
          plan.recargar();
          reportes.recargar();
        }}
      />
    );
  }

  if (reportes.error && !reportes.datos) return <ErrorVista error={reportes.error} onReintentar={reportes.recargar} />;

  return (
    <div className="space-y-10">
      <Ausentismo citas={citas.datos} ahora={ahora} />
      <HistorialEnvios reportes={reportes} />
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
        <p className="mt-1 text-sm text-[#A3AEBD]">
          El módulo está activo para la clínica; el detalle es de acceso restringido.
        </p>
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
        descripcion="Tasa de Ausentismo por doctor y reportes diarios enviados por correo a cada especialista."
      >
        {reportes.enPrueba && (
          <p
            role="status"
            className="inline-flex items-center gap-2 rounded-md border border-[#4A4230] px-3 py-2 text-sm text-[#C9AE72]"
          >
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