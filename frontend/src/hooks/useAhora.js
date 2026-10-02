import { useEffect, useState } from "react";

/** Marca de tiempo que se actualiza cada `intervaloMs` (para "en 20 min", "en curso", etc.). */
export function useAhora(intervaloMs = 30000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return ahora;
}
