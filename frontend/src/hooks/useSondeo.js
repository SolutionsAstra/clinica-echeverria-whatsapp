import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ejecuta `cargar(signal)` al montar, cada `intervaloMs` con la pestaña visible y al volver a ella.
 * - Cancela la petición anterior si llega una nueva (sin respuestas fuera de orden).
 * - Si una recarga falla, conserva los últimos datos buenos y expone `error`.
 * - `omitir()` permite saltar un ciclo automático (p. ej. mientras hay una reserva en curso).
 */
export function useSondeo(cargar, { intervaloMs = 0, omitir } = {}) {
  const [estado, setEstado] = useState({ datos: null, error: null, cargando: true, actualizadoEn: null });
  const cargarRef = useRef(cargar);
  const omitirRef = useRef(omitir);
  const controladorRef = useRef(null);

  useEffect(() => {
    cargarRef.current = cargar;
    omitirRef.current = omitir;
  });

  const abortar = useCallback(() => controladorRef.current?.abort(), []);

  const recargar = useCallback(async () => {
    controladorRef.current?.abort();
    const controlador = new AbortController();
    controladorRef.current = controlador;
    try {
      const datos = await cargarRef.current(controlador.signal);
      if (controlador.signal.aborted) return;
      setEstado({ datos, error: null, cargando: false, actualizadoEn: Date.now() });
    } catch (error) {
      if (controlador.signal.aborted || error?.name === "AbortError") return;
      setEstado((previo) => ({ ...previo, error, cargando: false }));
    }
  }, []);

  useEffect(() => {
    const automatico = () => {
      if (document.hidden || omitirRef.current?.()) return;
      recargar();
    };

    recargar();
    const intervalo = intervaloMs > 0 ? setInterval(automatico, intervaloMs) : null;
    document.addEventListener("visibilitychange", automatico);

    return () => {
      if (intervalo) clearInterval(intervalo);
      document.removeEventListener("visibilitychange", automatico);
      abortar();
    };
  }, [recargar, abortar, intervaloMs]);

  return { ...estado, recargar };
}
