/**
 * Recordatorio manual de UNA cita.
 *   Bloqueado: candado sutil + tooltip "Requiere la activación del Módulo de Notificaciones Avanzadas de Astra."
 *   Activo:    POST /api/citas/:id/recordatorio-manual (WhatsApp).
 * variante: "compacto" (tarjeta) | "icono" (fila de tabla) | "mini" (bloque del calendario) | "normal"
 */
import { useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { enviarRecordatorioManual, textoDeError } from "../../../api/panel";
import { MENSAJES, MODULO } from "../plan/plan";
import { TAMANO_COMPACTO } from "../ui/estilos";
import { BotonBloqueado } from "../ui/Premium";
import { FOCO } from "./tokens";

const ETIQUETA = "Lanzar Recordatorio Manual WhatsApp / Correo";

export default function BotonRecordatorio({ citaId, paciente, habilitado, variante = "compacto", className = "" }) {
  const [estado, setEstado] = useState("inactivo"); // inactivo | enviando | enviado
  const [error, setError] = useState(null);

  if (!habilitado) {
    return (
      <BotonBloqueado
        etiqueta={ETIQUETA}
        motivo={MENSAJES[MODULO.NOTIFICACIONES]}
        Icono={Send}
        variante={variante}
        className={className}
      />
    );
  }

  const enviar = async (e) => {
    e.stopPropagation();
    setEstado("enviando");
    setError(null);
    try {
      await enviarRecordatorioManual(citaId);
      setEstado("enviado");
    } catch (err) {
      setEstado("inactivo");
      setError(textoDeError(err));
    }
  };

  const conTexto = variante === "normal" || variante === "compacto";
  const texto = estado === "enviado" ? "Recordatorio enviado" : ETIQUETA;
  const Icono = estado === "enviando" ? Loader2 : estado === "enviado" ? Check : Send;

  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        onClick={enviar}
        disabled={estado !== "inactivo"}
        aria-label={conTexto ? undefined : `${texto}: ${paciente}`}
        title={conTexto ? undefined : texto}
        className={`inline-flex cursor-pointer items-center rounded-md border transition-colors duration-200 disabled:cursor-default ${
          estado === "enviado"
            ? "border-[#2C5B53] text-[#86D5BC]"
            : "border-[#243B5A] text-[#E6E9EE] hover:border-[#3A4F6E] hover:bg-[#12284A]/60"
        } ${TAMANO_COMPACTO[variante] ?? TAMANO_COMPACTO.compacto} ${FOCO}`}
      >
        <Icono
          aria-hidden
          className={`${variante === "mini" ? "h-3 w-3" : "h-3.5 w-3.5"} shrink-0 ${
            estado === "enviando" ? "animate-spin motion-reduce:animate-none" : ""
          }`}
          strokeWidth={1.75}
        />
        {conTexto && <span className={variante === "compacto" ? "min-w-0 flex-1" : ""}>{texto}</span>}
      </button>
      {error && (
        <span role="alert" className="text-[11px] leading-snug text-[#F2A7A0]">
          {error}
        </span>
      )}
    </span>
  );
}