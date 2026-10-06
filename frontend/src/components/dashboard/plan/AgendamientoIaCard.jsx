/**
 * AgendamientoIaCard — módulo "Agente IA Agenda" en Resumen (solo Dirección).
 *
 *   ┌ Agente IA Agenda ──────────┬─────────────────────────────────────────────────────┐
 *   │ descripción + estado        │ Bloqueado: vidrio + candado + Probar Gratis 7 días │  ≥ lg: dos columnas
 *   │                             │ Activo:    citas IA · fuera de horario · ausentismo │  <  lg: apiladas
 *   └─────────────────────────────┴─────────────────────────────────────────────────────┘
 *
 * Fuentes (el cliente no inventa cifras):
 *   GET /api/plan       estado del módulo y diasPruebaPorModulo.agendamiento_ia
 *   GET /api/impacto-ia ventanas calculadas con PlanService.pruebaDe('agendamiento_ia'):
 *                       citasIa, citasIaFueraDeHorario (America/Caracas + feriados), periodo anterior
 *   GET /api/citas      (ya cargado por AdminDashboard) → Tasa de Ausentismo del mismo periodo
 */
import { useCallback, useMemo } from "react";
import { Bot, CalendarCheck, Moon, RotateCw, UserX } from "lucide-react";
import { obtenerImpactoIa } from "../../../api/impactoIa";
import { textoDeError } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { tasaAusentismo } from "../reportes/ausentismo";
import { BOTON_SECUNDARIO, SUPERFICIE } from "../ui/estilos";
import { EnlaceAstra, SelloCandado } from "../ui/Premium";
import { AccionPrueba } from "../workspace/BloqueoPremium";
import { ZONA_CLINICA } from "../workspace/agenda";
import { MENSAJES, MODULO, diasPruebaDe, esBloqueoPremium, estadoModulo } from "./plan";

const SONDEO_IMPACTO_MS = 5 * 60_000;
const cargarImpacto = (signal) => obtenerImpactoIa({ signal });

const fmtDia = new Intl.DateTimeFormat("es-VE", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });
const rango = (v) => `${fmtDia.format(new Date(v.desde))} – ${fmtDia.format(new Date(v.hasta))}`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : null);

const COLOR_TONO = { bloqueado: "#7D8BA0", prueba: "#C9AE72", activo: "#86D5BC" };

function Insignia({ tono, children }) {
  const color = COLOR_TONO[tono];
  return (
    <p role="status" className="inline-flex w-fit items-center gap-2 rounded-full border border-[#243B5A] px-3 py-1 text-xs" style={{ color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </p>
  );
}

function Metrica({ Icono, etiqueta, valor, nota }) {
  return (
    <div className="min-w-0 px-6 py-5">
      <dt className="flex items-center gap-2 text-sm text-[#A3AEBD]">
        <Icono aria-hidden className="h-4 w-4 shrink-0 text-[#7D8BA0]" strokeWidth={1.5} />
        {etiqueta}
      </dt>
      <dd className="mt-3 text-[1.75rem] font-medium leading-none tracking-tight tabular-nums text-[#F2F4F7]">{valor}</dd>
      {nota && <dd className="mt-2 text-xs leading-snug text-[#7D8BA0]">{nota}</dd>}
    </div>
  );
}

/** Forma de las tres métricas, sin cifras: fondo del bloqueo y esqueleto de carga. */
function SiluetaMetricas({ pulso = false }) {
  const anim = pulso ? "motion-safe:animate-pulse" : "";
  return (
    <div className="grid grid-cols-1 divide-y divide-[#1A2D48] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-6 py-5">
          <div className={`h-3.5 w-36 rounded bg-[#12284A]/70 ${anim}`} />
          <div className={`mt-4 h-7 w-16 rounded bg-[#12284A]/60 ${anim}`} />
          <div className={`mt-3 h-3 w-28 rounded bg-[#12284A]/40 ${anim}`} />
        </div>
      ))}
    </div>
  );
}

function Bloqueo({ rol, estado, diasPrueba, resultadoPrueba, onActivada }) {
  return (
    // Una sola celda de grid para ambas capas: el alto se adapta al contenido en 320 px.
    <div className="grid">
      <div aria-hidden inert className="pointer-events-none select-none opacity-40 blur-[2px] [grid-area:1/1]">
        <SiluetaMetricas />
      </div>
      <div className="flex items-center p-4 [grid-area:1/1] sm:p-6">
        <div className="flex w-full flex-col gap-5 rounded-xl border border-[#243B5A] bg-[#0E1F36]/85 p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] backdrop-blur-xl xl:flex-row xl:items-center xl:gap-6">
          <SelloCandado />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-relaxed text-[#C7CCD3]">{MENSAJES[MODULO.AGENDAMIENTO_IA]}</p>
            {resultadoPrueba && <p className="mt-2 text-xs leading-relaxed text-[#A3AEBD]">{resultadoPrueba}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 xl:max-w-[20rem]">
            <AccionPrueba
              modulo={MODULO.AGENDAMIENTO_IA}
              rol={rol}
              pruebaDisponible={estado.conocido ? estado.pruebaDisponible : null}
              diasPrueba={diasPrueba}
              onActivada={onActivada}
            />
            <EnlaceAstra />
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorImpacto({ error, onReintentar }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-4 px-6 py-8">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#E6E9EE]">No se pudo leer el impacto del agente.</p>
        <p className="mt-1 max-w-md text-sm text-[#A3AEBD]">
          {error?.status === undefined
            ? "El servidor no respondió. Revisa el indicador de conexión del menú."
            : textoDeError(error, "El servidor rechazó la consulta. Intenta de nuevo.")}
        </p>
      </div>
      <button type="button" onClick={onReintentar} className={`${BOTON_SECUNDARIO} h-8 px-3`}>
        <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        Reintentar
      </button>
    </div>
  );
}

function Impacto({ datos, ausentismo }) {
  const { actual, anterior } = datos;
  const pctFuera = porcentaje(actual.citasIaFueraDeHorario, actual.citasIa);
  const { tasa, inasistentes, ocurridas } = ausentismo.actual;
  const previa = ausentismo.anterior.tasa;

  const notaAusentismo =
    tasa == null
      ? "Aún no hay citas ocurridas en el periodo."
      : `${plural(inasistentes, "paciente inasistente", "pacientes inasistentes")} de ${ocurridas} ${ocurridas === 1 ? "cita" : "citas"}` +
        (previa != null ? ` · periodo anterior: ${previa}%` : "");

  const comparacion =
    anterior.derivacionesRecibidas > 0
      ? `Periodo anterior (${rango(anterior)}): recepción recibió ${plural(anterior.derivacionesRecibidas, "solicitud", "solicitudes")} por WhatsApp para agendar a mano, ${anterior.derivacionesFueraDeHorario} fuera de horario; ${plural(anterior.derivacionesSinReservar, "quedó", "quedaron")} sin cita.`
      : `Periodo anterior (${rango(anterior)}): sin solicitudes derivadas a recepción para comparar.`;

  return (
    <>
      <dl className="grid grid-cols-1 divide-y divide-[#1A2D48] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metrica Icono={CalendarCheck} etiqueta="Citas agendadas por la IA" valor={actual.citasIa} nota={rango(actual)} />
        <Metrica
          Icono={Moon}
          etiqueta="Fuera de horario"
          valor={actual.citasIaFueraDeHorario}
          nota={pctFuera == null ? "Fuera del horario de recepción" : `${pctFuera}% de las citas de la IA, fuera del horario de recepción`}
        />
        <Metrica
          Icono={UserX}
          etiqueta={ausentismo.soloIa ? "Tasa de Ausentismo · citas de la IA" : "Tasa de Ausentismo del periodo"}
          valor={tasa == null ? "—" : `${tasa}%`}
          nota={notaAusentismo}
        />
      </dl>
      <p className="border-t border-[#1A2D48] px-6 py-4 text-xs leading-relaxed text-[#7D8BA0]">{comparacion}</p>
    </>
  );
}

export default function AgendamientoIaCard({ plan, citas, ahora, rol }) {
  const impacto = useSondeo(cargarImpacto, { intervaloMs: SONDEO_IMPACTO_MS });
  const { recargar: recargarPlan } = plan;
  const { recargar: recargarImpacto } = impacto;
  const alActivar = useCallback(() => {
    recargarPlan();
    recargarImpacto();
  }, [recargarPlan, recargarImpacto]);

  const estado = estadoModulo(plan.datos, MODULO.AGENDAMIENTO_IA, ahora);
  const diasPrueba = diasPruebaDe(plan.datos, MODULO.AGENDAMIENTO_IA);
  const datos = impacto.datos;
  const bloqueoServidor = esBloqueoPremium(impacto.error);
  // El plan manda; si /api/plan no respondió, decide el estado que trae /api/impacto-ia.
  const activo = !bloqueoServidor && (estado.conocido ? estado.habilitado : Boolean(datos?.modulo?.habilitado));
  const decidiendo = !estado.conocido && !datos && (plan.cargando || impacto.cargando);

  const ausentismo = useMemo(() => {
    if (!datos) return null;
    // Con la migración citas.origen, se mide solo lo que agendó la IA; sin ella, todo el periodo.
    const soloIa = Array.isArray(citas) && citas.some((c) => c?.origen === "ia");
    const base = { ahoraMs: ahora, origen: soloIa ? "ia" : null };
    return {
      soloIa,
      actual: tasaAusentismo(citas, { ...base, desde: datos.actual.desde, hasta: datos.actual.hasta }),
      anterior: tasaAusentismo(citas, { ...base, desde: datos.anterior.desde, hasta: datos.anterior.hasta }),
    };
  }, [datos, citas, ahora]);

  let tono = "bloqueado";
  let textoEstado = "No incluido en el plan";
  if (decidiendo) {
    textoEstado = "Verificando el plan…";
  } else if (activo && (estado.enPrueba || datos?.pruebaVigente)) {
    tono = "prueba";
    textoEstado = estado.diasRestantes
      ? `Prueba gratuita · ${estado.diasRestantes === 1 ? "queda 1 día" : `quedan ${estado.diasRestantes} días`}`
      : "Prueba gratuita en curso";
  } else if (activo) {
    tono = "activo";
    textoEstado = "Módulo activo";
  }

  const resultadoPrueba =
    !activo && datos?.fuente === "prueba"
      ? `Durante la prueba (${rango(datos.actual)}) la IA agendó ${plural(datos.actual.citasIa, "cita", "citas")}, ${datos.actual.citasIaFueraDeHorario} fuera de horario.`
      : null;

  let detalle;
  if (decidiendo) detalle = <SiluetaMetricas pulso />;
  else if (!activo) {
    detalle = (
      <Bloqueo rol={rol} estado={estado} diasPrueba={diasPrueba} resultadoPrueba={resultadoPrueba} onActivada={alActivar} />
    );
  } else if (!datos && impacto.error) detalle = <ErrorImpacto error={impacto.error} onReintentar={recargarImpacto} />;
  else if (!datos) detalle = <SiluetaMetricas pulso />;
  else detalle = <Impacto datos={datos} ausentismo={ausentismo} />;

  return (
    <section
      aria-labelledby="agente-ia-titulo"
      aria-busy={decidiendo || undefined}
      className={`${SUPERFICIE} mt-10 grid grid-cols-1 divide-y divide-[#1A2D48] overflow-hidden lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:divide-x lg:divide-y-0`}
    >
      <div className="flex flex-col justify-between gap-6 p-6">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#243B5A]">
              <Bot className="h-4 w-4 text-[#E6E9EE]" strokeWidth={1.5} />
            </span>
            <h2 id="agente-ia-titulo" className="text-base font-semibold tracking-tight text-[#E6E9EE]">
              Agente IA Agenda
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#A3AEBD]">
            El asistente de WhatsApp agenda y confirma citas por su cuenta las 24 horas, también fuera del horario de
            recepción (09:00 a 18:00, hora de Caracas).
          </p>
        </div>
        <Insignia tono={tono}>{textoEstado}</Insignia>
      </div>
      <div className="min-w-0">{detalle}</div>
    </section>
  );
}