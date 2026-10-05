/**
 * Pantalla de bloqueo comercial reutilizable: vidrio esmerilado, candado y "Probar Gratis por 3 días".
 * La usan Reportes, Derivaciones IA y cualquier sección cuyo servidor responda 403 MODULO_PREMIUM.
 *
 * El botón de prueba siempre está presente:
 *   - Dirección, con prueba disponible o sin dato del plan: activa la prueba (POST /api/plan/pruebas).
 *   - Otro rol, prueba ya usada o módulo sin identificar: visible pero inactivo, con el motivo.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { iniciarPrueba, textoDeError } from "../../../api/panel";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "../ui/estilos";
import { BotonBloqueado, EnlaceAstra, PanelPremium } from "../ui/Premium";
import { Resultado } from "../ui/Vista";

const ETIQUETA_PRUEBA = "Probar Gratis por 3 días";

function ActivarPrueba({ modulo, diasPrueba, onActivada }) {
  const [fase, setFase] = useState("inactivo"); // inactivo | confirmar | activando
  const [error, setError] = useState(null);

  const activar = async () => {
    setFase("activando");
    setError(null);
    try {
      await iniciarPrueba(modulo);
      onActivada?.();
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
        La prueba dura {diasPrueba} días desde ahora y solo puede usarse una vez. Al terminar, el módulo vuelve a
        bloquearse.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={activar} disabled={fase === "activando"} className={BOTON_PRIMARIO}>
          {fase === "activando" && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {fase === "activando" ? "Activando…" : "Activar prueba ahora"}
        </button>
        <button
          type="button"
          onClick={() => setFase("inactivo")}
          disabled={fase === "activando"}
          className={BOTON_SECUNDARIO}
        >
          Ahora no
        </button>
      </div>
      {error && <Resultado resultado={{ tipo: "error", texto: error }} />}
    </div>
  );
}

/**
 * @param {{ titulo: string, mensaje: string, modulo: string|null, rol: string,
 *           pruebaDisponible?: boolean|null, diasPrueba?: number, vistaPrevia?: React.ReactNode,
 *           onActivada?: () => void }} props
 *   pruebaDisponible null = el plan no conoce el módulo; el servidor decide al activar.
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
  let accion;
  if (!modulo) {
    accion = (
      <BotonBloqueado
        etiqueta={ETIQUETA_PRUEBA}
        motivo="Consulte a Soluciones Astra para activar la prueba de este módulo."
      />
    );
  } else if (pruebaDisponible === false) {
    accion = <BotonBloqueado etiqueta={ETIQUETA_PRUEBA} motivo="La prueba gratuita de este módulo ya se utilizó." />;
  } else if (rol !== "direccion") {
    accion = <BotonBloqueado etiqueta={ETIQUETA_PRUEBA} motivo="Solo Dirección puede activar la prueba gratuita." />;
  } else {
    accion = <ActivarPrueba modulo={modulo} diasPrueba={diasPrueba} onActivada={onActivada} />;
  }

  return (
    <PanelPremium titulo={titulo} mensaje={mensaje} vistaPrevia={vistaPrevia}>
      {accion}
      <EnlaceAstra />
    </PanelPremium>
  );
}