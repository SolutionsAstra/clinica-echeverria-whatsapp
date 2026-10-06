import { useEffect, useState } from "react";
import { obtenerImpactoIa } from "../../../api/impactoIa";
import { MENSAJES, MODULO } from "./plan";

const DIA_MS = 86_400_000;
const TZ = "America/Caracas";

function duracion(min) {
  if (min == null) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${Math.round(h / 24)} días`;
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const fecha = (iso) => new Date(iso).toLocaleDateString("es-VE", { day: "numeric", month: "long", timeZone: TZ });
const dias = (v) => Math.max(1, Math.round((Date.parse(v.hasta) - Date.parse(v.desde)) / DIA_MS));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function subtitulo({ fuente, pruebaVigente, modulo, actual }) {
  if (pruebaVigente) return `Prueba gratuita en curso · termina el ${fecha(modulo.pruebaExpiraEn)}`;
  if (fuente === "prueba" && modulo.origen === "contrato") return "Resultados de tu prueba gratuita · módulo activo";
  if (fuente === "prueba") return `Tu prueba gratuita terminó el ${fecha(actual.hasta)}`;
  return `Módulo activo · últimos ${dias(actual)} días`;
}

function Dato({ valor, etiqueta }) {
  return (
    <div className="rounded-md border border-[#1A2D48] bg-[#0B192C]/50 p-3">
      <p className="text-2xl font-semibold tabular-nums text-[#F2F4F7]">{valor}</p>
      <p className="mt-1 text-xs text-[#A3AEBD]">{etiqueta}</p>
    </div>
  );
}

/** Tarjeta comercial para Dirección: qué cambió con el Agendamiento con IA. */
export default function ImpactoIaCard() {
  const [estado, setEstado] = useState({ cargando: true, datos: null, error: null });

  useEffect(() => {
    const ctrl = new AbortController();
    obtenerImpactoIa({ signal: ctrl.signal })
      .then((datos) => setEstado({ cargando: false, datos, error: null }))
      .catch((error) => {
        if (error?.name !== "AbortError") setEstado({ cargando: false, datos: null, error });
      });
    return () => ctrl.abort();
  }, []);

  if (estado.cargando) {
    return <p role="status" className="text-sm text-[#7D8BA0]">Calculando el impacto del agendamiento con IA…</p>;
  }
  if (estado.error || !estado.datos) return null; // métrica secundaria: no bloquea el resumen

  const d = estado.datos;
  const { actual, anterior, modulo } = d;

  // Nunca probado ni contratado: invitación breve, sin números en cero.
  if (d.fuente !== "prueba" && !modulo.habilitado) {
    return (
      <section aria-labelledby="impacto-ia-titulo" className="rounded-lg border border-[#1A2D48] bg-[#12284A]/40 p-4">
        <h2 id="impacto-ia-titulo" className="text-sm font-semibold text-[#E6E9EE]">Agendamiento con IA</h2>
        <p className="mt-2 text-sm text-[#A3AEBD]">
          Prueba gratis 7 días: el asistente confirmará citas por WhatsApp a cualquier hora y aquí verás la diferencia.
        </p>
        <p className="mt-2 text-xs text-[#7D8BA0]">{MENSAJES[MODULO.AGENDAMIENTO_IA]}</p>
      </section>
    );
  }

  const espera = duracion(anterior.esperaPromedioMin);
  const comparacion = anterior.derivacionesRecibidas === 0
    ? "No hay solicitudes en el periodo anterior para comparar."
    : `En los ${dias(anterior)} días anteriores, recepción recibió ${plural(anterior.derivacionesRecibidas, "solicitud", "solicitudes")} `
      + `por WhatsApp (${anterior.derivacionesFueraDeHorario} fuera de horario)`
      + (espera ? `, tardó en promedio ${espera} en confirmar cada una` : "")
      + ` y ${plural(anterior.derivacionesSinReservar, "quedó", "quedaron")} sin cita.`;
  const mostrarCta = !modulo.habilitado || modulo.origen === "prueba";

  return (
    <section aria-labelledby="impacto-ia-titulo" className="rounded-lg border border-[#1A2D48] bg-[#12284A]/40 p-4">
      <h2 id="impacto-ia-titulo" className="text-sm font-semibold text-[#E6E9EE]">Impacto del Agendamiento con IA</h2>
      <p className="mt-1 text-xs text-[#7D8BA0]">{subtitulo(d)}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Dato valor={actual.citasIa} etiqueta={`citas agendadas por la IA en ${plural(dias(actual), "día", "días")}`} />
        <Dato valor={actual.citasIaFueraDeHorario} etiqueta="fuera del horario de recepción" />
        <Dato valor="Al instante" etiqueta={espera ? `confirmación (antes: ${espera})` : "confirmación al paciente"} />
      </div>

      <p className="mt-4 text-sm text-[#A3AEBD]">{comparacion}</p>
      {mostrarCta && <p className="mt-3 text-xs text-[#7D8BA0]">{MENSAJES[MODULO.AGENDAMIENTO_IA]}</p>}
    </section>
  );
}