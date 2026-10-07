/**
 * Bandeja del agente IA dentro del panel.
 *   1. Normaliza GET /api/derivaciones (camelCase o snake_case) antes de pintar.
 *   2. Nunca pasa `undefined` a <BandejaDerivaciones>: con undefined mostraría sus datos de demostración.
 *   3. <BandejaDerivaciones> copia `solicitudes` a su estado solo al montarse; la key la remonta
 *      cuando cambia el conjunto de ids (el sondeo se pausa mientras hay una reserva en curso).
 */
import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import BandejaDerivaciones from "../BandejaDerivaciones";
import { normalizarSolicitudes } from "../derivaciones/normalizar";

export default function BandejaEmbebida({ solicitudes, onReservar }) {
  const { validas, descartadas } = useMemo(() => normalizarSolicitudes(solicitudes), [solicitudes]);
  const firma = useMemo(() => validas.map((s) => s.id).join("|"), [validas]);

  return (
    <>
      {descartadas > 0 && (
        <p
          role="status"
          className="mx-5 mt-6 flex items-start gap-2 rounded-md border border-[#1A2D48] bg-[#0B192C]/70 px-4 py-3 text-sm text-[#A3AEBD] lg:mx-8"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#C9AE72]" strokeWidth={1.75} />
          {descartadas === 1
            ? "1 solicitud llegó con datos incompletos y no se muestra. Quedó registrada en el servidor."
            : `${descartadas} solicitudes llegaron con datos incompletos y no se muestran. Quedaron registradas en el servidor.`}
        </p>
      )}
      <BandejaDerivaciones key={firma} solicitudes={validas} onReservar={onReservar} embebida />
    </>
  );
}