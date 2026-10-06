/**
 * Bloqueo comercial reutilizable: vidrio esmerilado, candado y "Probar Gratis por N días".
 *   <BloqueoPremium>        pantalla completa de un módulo (Reportes, Derivaciones IA…)
 *   <BloqueoPorRespuesta>   la misma pantalla armada desde un 403 MODULO_PREMIUM (la usa <ErrorVista>)
 *   <AccionPrueba>          solo el botón de prueba, para tarjetas (AgendamientoIaCard)
 * N sale de GET /api/plan → diasPruebaPorModulo (3 reportes, 7 agendamiento_ia).
 * Este archivo NO importa ui/Vista: Vista lo importa a él (sin dependencias circulares).
 */
import { useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { iniciarPrueba, textoDeError } from "../../../api/panel";
import { usePlanPanel } from "../plan/ContextoPlan";
import { MENSAJES, TITULOS, diasPruebaDe, estadoModulo, etiquetaPrueba } from "../plan/plan";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, SUPERFICIE } from "../ui/estilos";
import { BotonBloqueado, EnlaceAstra, PanelPremium } from "../ui/Premium";

const MENSAJE_GENERICO =
  "Este módulo no está incluido en el plan de la clínica. Consulte a Soluciones Astra para habilitarlo.";

function ActivarPrueba({ modulo, diasPrueba, onActivada }) {
  const [fase, setFase] = useState("inactivo"); // inactivo | confirmar | activando | activada
  const [error, setError] = useState(null);

  const activar = async () => {
    setFase("activando");
    setError(null);
    try {
      await iniciarPrueba(modulo);
      setFase("activada");
      onActivada?.();
    } catch (err) {
      setError(textoDeError(err));
      setFase("confirmar");
    }
  };

  if (fase === "activada") {
    return (
      <p role="status" className="inline-flex items-center gap-2 text-sm text-[#86D5BC]">
        <Check aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        Prueba activada. Cargando el módulo…
      </p>
    );
  }

  if (fase === "inactivo") {
    return (
      <button type="button" onClick={() => setFase("confirmar")} className={BOTON_PRIMARIO}>
        {etiquetaPrueba(diasPrueba)}
      </button>
    );
  }

  return (
    <div className="w-full space-y-4">
      <p className="text-sm text-[#A3AEBD]">
        La prueba dura {diasPrueba} {diasPrueba === 1 ? "día" : "días"} desde ahora y solo puede usarse una vez. Al
        terminar, el módulo vuelve a bloquearse.
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
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-[#F2A7A0]">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Botón de prueba siempre visible cuando el módulo la ofrece:
 *   Dirección con prueba disponible (o sin dato del plan) → activa la prueba.
 *   Otro rol, prueba usada o módulo sin identificar → visible pero inactivo, con el motivo.
 *   Módulo sin prueba (0 días) → nada; queda el mensaje de Soluciones Astra.
 */
export function AccionPrueba({ modulo, rol, pruebaDisponible = null, diasPrueba = 3, onActivada }) {
  if (!modulo) {
    return (
      <BotonBloqueado etiqueta={etiquetaPrueba(0)} motivo="Consulte a Soluciones Astra para activar la prueba de este módulo." />
    );
  }
  if (diasPrueba <= 0) return null;
  const etiqueta = etiquetaPrueba(diasPrueba);
  if (pruebaDisponible === false) {
    return <BotonBloqueado etiqueta={etiqueta} motivo="La prueba gratuita de este módulo ya se utilizó." />;
  }
  if (rol !== "direccion") {
    return <BotonBloqueado etiqueta={etiqueta} motivo="Solo Dirección puede activar la prueba gratuita." />;
  }
  return <ActivarPrueba modulo={modulo} diasPrueba={diasPrueba} onActivada={onActivada} />;
}

/**
 * @param {{ titulo: string, mensaje: string, modulo: string|null, rol: string,
 *           pruebaDisponible?: boolean|null, diasPrueba?: number, vistaPrevia?: React.ReactNode,
 *           onActivada?: () => void }} props
 */
export default function BloqueoPremium({
  titulo,
  mensaje,
  modulo,
  rol,
  pruebaDisponible = null,
  diasPrueba = 3,
  vistaPrevia = null,
  onActivada,
}) {
  return (
    <PanelPremium titulo={titulo} mensaje={mensaje} vistaPrevia={vistaPrevia}>
      <AccionPrueba
        modulo={modulo}
        rol={rol}
        pruebaDisponible={pruebaDisponible}
        diasPrueba={diasPrueba}
        onActivada={onActivada}
      />
      <EnlaceAstra />
    </PanelPremium>
  );
}

/** Silueta neutra para el fondo del bloqueo cuando la vista no aporta la suya. */
function SiluetaModulo() {
  return (
    <div className="space-y-6 p-8">
      <div className={`${SUPERFICIE} p-6`}>
        <div className="h-4 w-56 rounded bg-[#1A2D48]" />
        <div className="mt-6 grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-md border border-[#1A2D48]" />
          ))}
        </div>
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

/** Bloqueo construido a partir del 403: módulo, texto de Soluciones Astra y días reales del plan. */
export function BloqueoPorRespuesta({ error, vistaPrevia = null, onActivada }) {
  const { plan, rol, ahora } = usePlanPanel();
  const modulo = typeof error?.modulo === "string" ? error.modulo : null;
  const e = modulo ? estadoModulo(plan?.datos, modulo, ahora) : null;

  return (
    <BloqueoPremium
      titulo={(modulo && TITULOS[modulo]) || "Módulo Premium de Astra"}
      mensaje={(modulo && MENSAJES[modulo]) || textoDeError(error, MENSAJE_GENERICO)}
      modulo={modulo}
      rol={rol}
      pruebaDisponible={e?.conocido ? e.pruebaDisponible : null}
      diasPrueba={diasPruebaDe(plan?.datos, modulo)}
      vistaPrevia={vistaPrevia ?? <SiluetaModulo />}
      onActivada={() => {
        plan?.recargar?.();
        onActivada?.();
      }}
    />
  );
}