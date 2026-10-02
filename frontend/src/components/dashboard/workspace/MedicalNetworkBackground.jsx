import { useEffect, useRef } from "react";

/**
 * Red de cruces médicas y partículas sobre #0B192C. Compartido con LoginForm:
 *   <MedicalNetworkBackground />  (se posiciona fixed detrás del contenido)
 *
 * Solo líneas de 1px en platino a baja opacidad; sin degradados ni glow.
 * Se congela con prefers-reduced-motion y se pausa con la pestaña oculta.
 */
const PLATINO = "163, 174, 189"; // #A3AEBD
const AREA_POR_NODO = 22000; // px² por nodo → densidad baja
const MAX_NODOS = 64;
const DISTANCIA_ENLACE = 150;
const VELOCIDAD = 0.06; // px por cuadro: movimiento atenuado
const PROPORCION_CRUCES = 0.35;
const BRAZO_CRUZ = 4;

function crearNodos(ancho, alto) {
  const total = Math.min(MAX_NODOS, Math.max(12, Math.round((ancho * alto) / AREA_POR_NODO)));
  return Array.from({ length: total }, () => {
    const angulo = Math.random() * Math.PI * 2;
    return {
      x: Math.random() * ancho,
      y: Math.random() * alto,
      vx: Math.cos(angulo) * VELOCIDAD,
      vy: Math.sin(angulo) * VELOCIDAD,
      cruz: Math.random() < PROPORCION_CRUCES,
    };
  });
}

export default function MedicalNetworkBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;

    const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)");
    let ancho = 0;
    let alto = 0;
    let nodos = [];
    let cuadro = 0;

    const dibujar = () => {
      ctx.clearRect(0, 0, ancho, alto);
      ctx.lineWidth = 1;

      for (let i = 0; i < nodos.length; i += 1) {
        const a = nodos[i];
        for (let j = i + 1; j < nodos.length; j += 1) {
          const b = nodos[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < DISTANCIA_ENLACE) {
            ctx.strokeStyle = `rgba(${PLATINO}, ${(0.1 * (1 - d / DISTANCIA_ENLACE)).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodos) {
        // +0.5 alinea el trazo de 1px a la rejilla de píxeles: líneas nítidas, no borrosas.
        const x = Math.round(n.x) + 0.5;
        const y = Math.round(n.y) + 0.5;
        if (n.cruz) {
          ctx.strokeStyle = `rgba(${PLATINO}, 0.32)`;
          ctx.beginPath();
          ctx.moveTo(x - BRAZO_CRUZ, y);
          ctx.lineTo(x + BRAZO_CRUZ, y);
          ctx.moveTo(x, y - BRAZO_CRUZ);
          ctx.lineTo(x, y + BRAZO_CRUZ);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${PLATINO}, 0.28)`;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    };

    const avanzar = () => {
      for (const n of nodos) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > ancho) n.vx *= -1;
        if (n.y < 0 || n.y > alto) n.vy *= -1;
      }
      dibujar();
      cuadro = requestAnimationFrame(avanzar);
    };

    const arrancar = () => {
      cancelAnimationFrame(cuadro);
      if (movimientoReducido.matches || document.hidden) dibujar();
      else cuadro = requestAnimationFrame(avanzar);
    };

    const dimensionar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = canvas.clientWidth;
      alto = canvas.clientHeight;
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodos = crearNodos(ancho, alto);
      arrancar();
    };

    const observador = new ResizeObserver(dimensionar);
    observador.observe(canvas);
    document.addEventListener("visibilitychange", arrancar);
    movimientoReducido.addEventListener("change", arrancar);

    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      document.removeEventListener("visibilitychange", arrancar);
      movimientoReducido.removeEventListener("change", arrancar);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
