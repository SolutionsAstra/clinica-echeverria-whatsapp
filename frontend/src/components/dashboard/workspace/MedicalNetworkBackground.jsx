import { useEffect, useRef } from "react";

/**
 * Red de cruces médicas y partículas sobre #0B192C. Compartido con LoginForm:
 *   <MedicalNetworkBackground />  (se posiciona fixed detrás del contenido)
 *
 * Interactivo: el cursor se integra a la red como un nodo más. Enlaza con las partículas cercanas
 * y las aparta con suavidad. El lienzo no captura eventos (pointer-events-none); escucha en window,
 * así que nunca interfiere con clics en el panel.
 *
 * Solo líneas de 1px en platino a baja opacidad; sin degradados ni glow.
 * Con prefers-reduced-motion la red queda quieta y el cursor solo dibuja enlaces, sin desplazar nada.
 * Con la pestaña oculta se pausa.
 */
const PLATINO = "163, 174, 189"; // #A3AEBD
const AREA_POR_NODO = 22000; // px² por nodo → densidad baja
const MAX_NODOS = 64;
const DISTANCIA_ENLACE = 150;
const VELOCIDAD = 0.06; // px por cuadro: movimiento atenuado
const PROPORCION_CRUCES = 0.35;
const BRAZO_CRUZ = 4;
const RADIO_CURSOR = 170; // alcance de los enlaces con el cursor
const EMPUJE_CURSOR = 0.035; // aceleración máxima por cuadro, en el centro del radio
const RETORNO = 0.02; // fracción por cuadro con la que una partícula recupera su velocidad de deriva

function crearNodos(ancho, alto) {
  const total = Math.min(MAX_NODOS, Math.max(12, Math.round((ancho * alto) / AREA_POR_NODO)));
  return Array.from({ length: total }, () => {
    const angulo = Math.random() * Math.PI * 2;
    const vx = Math.cos(angulo) * VELOCIDAD;
    const vy = Math.sin(angulo) * VELOCIDAD;
    return { x: Math.random() * ancho, y: Math.random() * alto, vx, vy, vx0: vx, vy0: vy, cruz: Math.random() < PROPORCION_CRUCES };
  });
}

export default function MedicalNetworkBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;

    const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)");
    const puntero = { x: 0, y: 0, activo: false };
    let ancho = 0;
    let alto = 0;
    let nodos = [];
    let cuadro = 0;

    const enPausa = () => movimientoReducido.matches || document.hidden;

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

      if (puntero.activo) {
        for (const n of nodos) {
          const d = Math.hypot(n.x - puntero.x, n.y - puntero.y);
          if (d < RADIO_CURSOR) {
            ctx.strokeStyle = `rgba(${PLATINO}, ${(0.18 * (1 - d / RADIO_CURSOR)).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(puntero.x, puntero.y);
            ctx.lineTo(n.x, n.y);
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
        if (puntero.activo) {
          const dx = n.x - puntero.x;
          const dy = n.y - puntero.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.5 && d < RADIO_CURSOR) {
            const fuerza = EMPUJE_CURSOR * (1 - d / RADIO_CURSOR) ** 2;
            n.vx += (dx / d) * fuerza;
            n.vy += (dy / d) * fuerza;
          }
        }
        // Vuelve poco a poco a su deriva original: el empuje nunca se acumula.
        n.vx += (n.vx0 - n.vx) * RETORNO;
        n.vy += (n.vy0 - n.vy) * RETORNO;
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > ancho) {
          n.vx *= -1;
          n.vx0 *= -1;
          n.x = Math.min(Math.max(n.x, 0), ancho);
        }
        if (n.y < 0 || n.y > alto) {
          n.vy *= -1;
          n.vy0 *= -1;
          n.y = Math.min(Math.max(n.y, 0), alto);
        }
      }
      dibujar();
      cuadro = requestAnimationFrame(avanzar);
    };

    const arrancar = () => {
      cancelAnimationFrame(cuadro);
      if (enPausa()) dibujar();
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

    const alMover = (e) => {
      if (e.pointerType === "touch") return; // en pantallas táctiles no hay cursor que seguir
      puntero.x = e.clientX;
      puntero.y = e.clientY;
      puntero.activo = true;
      if (enPausa()) dibujar(); // sin animación: solo se actualizan los enlaces
    };
    const alSalir = () => {
      puntero.activo = false;
      if (enPausa()) dibujar();
    };

    const observador = new ResizeObserver(dimensionar);
    observador.observe(canvas);
    document.addEventListener("visibilitychange", arrancar);
    movimientoReducido.addEventListener("change", arrancar);
    window.addEventListener("pointermove", alMover, { passive: true });
    document.documentElement.addEventListener("pointerleave", alSalir);
    window.addEventListener("blur", alSalir);

    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      document.removeEventListener("visibilitychange", arrancar);
      movimientoReducido.removeEventListener("change", arrancar);
      window.removeEventListener("pointermove", alMover);
      document.documentElement.removeEventListener("pointerleave", alSalir);
      window.removeEventListener("blur", alSalir);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
