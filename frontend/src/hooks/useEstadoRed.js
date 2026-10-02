import { useCallback, useEffect, useState } from "react";
import { obtenerSesion } from "../api/panel";
import { clasificarRed } from "../components/dashboard/workspace/agenda";
import { useSondeo } from "./useSondeo";

const LATIDO_MS = 30000;

/**
 * Estado de red medido contra el propio backend (no solo navigator.onLine, que da
 * "en línea" aunque el servidor no responda). El latido es GET /api/auth/me, que además
 * entrega el usuario de la sesión y, si la sesión expiró, redirige al login vía pedir().
 */
export function useEstadoRed() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  const latido = useCallback(async (signal) => {
    const t0 = performance.now();
    const usuario = await obtenerSesion({ signal });
    return { usuario, latenciaMs: Math.round(performance.now() - t0) };
  }, []);

  const { datos, error, recargar } = useSondeo(latido, { intervaloMs: LATIDO_MS });

  useEffect(() => {
    const alConectar = () => {
      setOnline(true);
      recargar();
    };
    const alDesconectar = () => setOnline(false);
    window.addEventListener("online", alConectar);
    window.addEventListener("offline", alDesconectar);
    return () => {
      window.removeEventListener("online", alConectar);
      window.removeEventListener("offline", alDesconectar);
    };
  }, [recargar]);

  return {
    estado: clasificarRed({ online, error, latenciaMs: datos?.latenciaMs ?? null }),
    latenciaMs: datos?.latenciaMs ?? null,
    usuario: datos?.usuario ?? null,
  };
}
