/**
 * Reportes — módulo premium.
 *   Bloqueado  → <PanelPremium> sobre una vista previa atenuada (forma del módulo, sin datos).
 *   En prueba  → aviso con los días restantes + el módulo completo.
 *   Contratado → el módulo completo.
 * El historial de envíos solo se pide con el módulo activo: así no hay 403 en la consola.
 */
import { useMemo, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { generarReporteAhora, iniciarPrueba, listarReportes, textoDeError } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { MENSAJES, MODULO, estadoModulo } from "../plan/plan";
import { ausentismoPorDoctor } from "../reportes/ausentismo";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, FILA, SUPERFICIE, TABLA, TD, TH } from "../ui/estilos";
import { fechaHora, fechaLarga } from "../ui/formato";
import { EnlaceAstra, PanelPremium } from "../ui/Premium";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado, VacioVista } from "../ui/Vista";

const ETIQUETA_PRUEBA = "Probar Gratis por 3 días";
const cargarReportes = (signal) => listarReportes({ signal });

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

function ActivarPrueba({ diasPrueba, onActivada }) {
  const [fase, setFase] = useState("inactivo"); // inactivo | confirmar | activando
  const [error, setError] = useState(null);

  const activar = async () => {
    setFase("activando");
    setError(null);
    try {
      await iniciarPrueba(MODULO.REPORTES);
      onActivada();
    } catch (err) {
      setError(textoDeError(err));
      setFase("confirmar");
    }
  };

  if (fase === "inactivo") {
    return (
      <button type="button" onClick={() => setFase("confirmar")} className={BOTON_PRIMARIO}>
        {ETIQUETA_PRUEBA}
      </button>
    );
  }
  return (
    <div className="w-full space-y-4">
      <p className="text-sm text-[#A3AEBD]">
        La prueba dura {diasPrueba} días desde ahora y solo puede usarse una vez. Al terminar, el módulo vuelve a bloquearse.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={activar} disabled={fase === "activando"} className={BOTON_PRIMARIO}>
          {fase === "activando" && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {fase === "activando" ? "Activando…" : "Activar prueba ahora"}
        </button>
        <button type="button" onClick={() => setFase("inactivo")} disabled={fase === "activando"} className={BOTON_SECUNDARIO}>
          Ahora no
        </button>
      </div>
      {error && <Resultado resultado={{ tipo: "error", texto: error }} />}
    </div>
  );
}

function Ausentismo({ citas, ahora }) {
  const filas = useMemo(() => ausentismoPorDoctor(citas, ahora), [citas, ahora]);
  return (
    <section aria-labelledby="ausentismo-titulo" className={`${SUPERFICIE} p-6`}>
      <h2 id="ausentismo-titulo" className="text-base font-semibold text-[#E6E9EE]">
        Ausentismo por doctor
      </h2>
      <p className="mt-1 text-sm text-[#A3AEBD]">Porcentaje de citas ya ocurridas en las que el paciente no se presentó.</p>
      {filas.length === 0 ? (
        <VacioVista titulo="Aún no hay citas ocurridas para medir." />
      ) : (
        <ul className="mt-6 space-y-4">
          {filas.map((f) => (
            <li key={f.doctorId} className="grid grid-cols-[12rem_minmax(0,1fr)_7rem] items-center gap-4">
              <span className="truncate text-sm text-[#E6E9EE]">{f.doctor}</span>
              <span aria-hidden className="h-1.5 rounded-full bg-[#1A2D48]">
                <span className="block h-full rounded-full bg-[#C9AE72]" style={{ width: `${f.tasa}%` }} />
              </span>
              <span className="text-right text-sm tabular-nums text-[#C7CCD3]">
                {f.tasa}% <span className="text-[#7D8BA0]">({f.noShow}/{f.ocurridas})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistorialEnvios() {
  const reportes = useSondeo(cargarReportes);
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
      {reportes.cargando && !reportes.datos ? (
        <CargaVista filas={3} />
      ) : reportes.error && !reportes.datos ? (
        <ErrorVista detalle={textoDeError(reportes.error)} onReintentar={reportes.recargar} />
      ) : (
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
      )}
    </section>
  );
}

export default function ReportesView({ plan, citas, ahora, rol }) {
  const reportes = estadoModulo(plan.datos, MODULO.REPORTES, ahora);
  const esDireccion = rol === "direccion";

  let contenido;
  if (!reportes.conocido) {
    contenido = plan.error ? <ErrorVista onReintentar={plan.recargar} /> : <CargaVista filas={4} />;
  } else if (!reportes.habilitado) {
    contenido = (
      <PanelPremium titulo="Analítica avanzada de ausentismo" mensaje={MENSAJES[MODULO.REPORTES]} vistaPrevia={<VistaPrevia />}>
        {reportes.pruebaDisponible && esDireccion && (
          <ActivarPrueba diasPrueba={plan.datos?.diasPrueba ?? 3} onActivada={plan.recargar} />
        )}
        {reportes.pruebaDisponible && !esDireccion && (
          <p className="text-sm text-[#A3AEBD]">Dirección puede activar una prueba gratuita de 3 días.</p>
        )}
        {!reportes.pruebaDisponible && <p className="text-sm text-[#A3AEBD]">La prueba gratuita de este módulo ya se utilizó.</p>}
        <EnlaceAstra />
      </PanelPremium>
    );
  } else if (!esDireccion) {
    contenido = (
      <div className={`${SUPERFICIE} px-6 py-10`}>
        <p className="text-sm font-medium text-[#E6E9EE]">Los reportes los consulta Dirección.</p>
        <p className="mt-1 text-sm text-[#A3AEBD]">El módulo está activo para la clínica; el detalle es de acceso restringido.</p>
      </div>
    );
  } else {
    contenido = (
      <div className="space-y-10">
        <Ausentismo citas={citas.datos} ahora={ahora} />
        <HistorialEnvios />
      </div>
    );
  }

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Reportes"
        descripcion="Inasistencia por doctor y reportes diarios enviados por correo a cada especialista."
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
