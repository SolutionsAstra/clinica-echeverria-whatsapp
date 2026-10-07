/**
 * Tarjetas premium de Reportes (Dirección). Datos: GET /api/impacto-ia → premium
 * (src/modules/impacto-ia/domain/premium.ts). Ventana: últimos 7 días contra los 7 anteriores.
 */
import { Banknote, MessagesSquare, RotateCw, UserX } from "lucide-react";
import { textoDeError } from "../../../api/panel";
import { BOTON_SECUNDARIO, SUPERFICIE } from "../ui/estilos";
import { ZONA_CLINICA } from "../workspace/agenda";
import { especialidad } from "../workspace/especialidades";

const fmtDia = new Intl.DateTimeFormat("es-VE", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });
const rango = (v) => `${fmtDia.format(new Date(v.desde))} – ${fmtDia.format(new Date(v.hasta))}`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function dinero(monto, moneda) {
  try {
    return new Intl.NumberFormat("es-VE", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(monto);
  } catch {
    return `${Math.round(monto)} ${moneda}`;
  }
}

const COLOR_MEJOR = "#86D5BC";
const COLOR_PEOR = "#C9AE72";

function Variacion({ actual, anterior, menorEsMejor = false, formatear = (n) => `${n} pts` }) {
  if (actual == null || anterior == null) {
    return <p className="mt-2 text-xs text-[#7D8BA0]">Sin datos de los 7 días anteriores para comparar.</p>;
  }
  const delta = actual - anterior;
  if (delta === 0) return <p className="mt-2 text-xs text-[#7D8BA0]">Igual que los 7 días anteriores.</p>;
  const mejora = menorEsMejor ? delta < 0 : delta > 0;
  return (
    <p className="mt-2 text-xs" style={{ color: mejora ? COLOR_MEJOR : COLOR_PEOR }}>
      {delta > 0 ? "+" : "−"}
      {formatear(Math.abs(delta))} frente a los 7 días anteriores
    </p>
  );
}

function Barra({ porcentaje, color }) {
  const ancho = Math.max(0, Math.min(100, porcentaje ?? 0));
  return (
    <span aria-hidden className="block h-1 w-full rounded-full bg-[#1A2D48]">
      <span className="block h-full rounded-full" style={{ width: `${ancho}%`, backgroundColor: color }} />
    </span>
  );
}

function Fila({ color, etiqueta, valor, porcentaje = null }) {
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-[#C7CCD3]">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="truncate">{etiqueta}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[#E6E9EE]">{valor}</span>
      </div>
      {porcentaje != null && <Barra porcentaje={porcentaje} color={color} />}
    </li>
  );
}

function Tarjeta({ Icono, titulo, valor, resumen, variacion, pie, children }) {
  return (
    <article className={`${SUPERFICIE} flex min-w-0 flex-col p-6`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#243B5A]">
          <Icono className="h-4 w-4 text-[#E6E9EE]" strokeWidth={1.5} />
        </span>
        <h3 className="text-sm font-medium leading-snug text-[#E6E9EE]">{titulo}</h3>
      </div>
      <p className="mt-6 text-[2.25rem] font-medium leading-none tracking-tight tabular-nums text-[#F2F4F7]">{valor}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#A3AEBD]">{resumen}</p>
      {variacion}
      <div className="mt-6 flex-1 border-t border-[#1A2D48] pt-4">{children}</div>
      {pie && <p className="mt-4 text-xs leading-relaxed text-[#7D8BA0]">{pie}</p>}
    </article>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" aria-label="Cargando métricas premium" className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${SUPERFICIE} p-6`}>
          <div className="h-4 w-48 rounded bg-[#12284A]/70 motion-safe:animate-pulse" />
          <div className="mt-6 h-9 w-24 rounded bg-[#12284A]/60 motion-safe:animate-pulse" />
          <div className="mt-3 h-3 w-56 rounded bg-[#12284A]/40 motion-safe:animate-pulse" />
          <div className="mt-8 space-y-3 border-t border-[#1A2D48] pt-4">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-3 w-full rounded bg-[#12284A]/40 motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Ausentismo({ actual, anterior }) {
  const a = actual.ausentismo;
  return (
    <Tarjeta
      Icono={UserX}
      titulo="Analítica Avanzada de Ausentismo (Pacientes Inasistentes)"
      valor={a.tasa == null ? "—" : `${a.tasa}%`}
      resumen={
        a.tasa == null
          ? "Aún no hay citas ocurridas en el periodo."
          : `${plural(a.inasistentes, "paciente inasistente", "pacientes inasistentes")} de ${plural(a.ocurridas, "cita", "citas")}`
      }
      variacion={<Variacion actual={a.tasa} anterior={anterior.ausentismo.tasa} menorEsMejor />}
    >
      {a.porEspecialidad.length === 0 ? (
        <p className="text-sm text-[#7D8BA0]">Sin citas ocurridas por especialidad.</p>
      ) : (
        <ul className="space-y-3">
          {a.porEspecialidad.map((f) => {
            const esp = especialidad(f.especialidad);
            return (
              <Fila
                key={f.especialidad}
                color={esp.color}
                etiqueta={esp.nombre}
                valor={`${f.tasa ?? 0}% · ${f.inasistentes}/${f.ocurridas}`}
                porcentaje={f.tasa}
              />
            );
          })}
        </ul>
      )}
    </Tarjeta>
  );
}

function Conversion({ actual, anterior }) {
  const c = actual.conversion;
  const parte = (n) => (c.solicitudes > 0 ? Math.round((n / c.solicitudes) * 100) : 0);
  return (
    <Tarjeta
      Icono={MessagesSquare}
      titulo="Tasa de Conversión Conversacional de la IA"
      valor={c.tasaAutonoma == null ? "—" : `${c.tasaAutonoma}%`}
      resumen={
        c.solicitudes === 0
          ? "Sin solicitudes de cita por WhatsApp en el periodo."
          : `${c.citasIa} de ${plural(c.solicitudes, "solicitud", "solicitudes")} por WhatsApp terminaron en cita sin intervención humana`
      }
      variacion={<Variacion actual={c.tasaAutonoma} anterior={anterior.conversion.tasaAutonoma} />}
      pie={
        c.tasaTotal == null
          ? "Base: solicitudes de cita recibidas por el asistente de WhatsApp."
          : `Con el apoyo de recepción desde la bandeja, la conversión llega al ${c.tasaTotal}%.`
      }
    >
      <ul className="space-y-3">
        <Fila color={COLOR_MEJOR} etiqueta="Agendadas por la IA" valor={c.citasIa} porcentaje={parte(c.citasIa)} />
        <Fila color="#A3AEBD" etiqueta="Agendadas por recepción" valor={c.reservadasPorRecepcion} porcentaje={parte(c.reservadasPorRecepcion)} />
        <Fila color="#7D8BA0" etiqueta="Aún sin cita" valor={c.sinCita} porcentaje={parte(c.sinCita)} />
      </ul>
    </Tarjeta>
  );
}

function Ingresos({ actual, anterior, moneda, tarifasConfiguradas }) {
  const i = actual.ingresosFueraDeHorario;
  const previo = anterior.ingresosFueraDeHorario.monto;
  let pie = null;
  if (!tarifasConfiguradas) pie = "Faltan las tarifas por especialidad para proyectar el monto. Soluciones Astra las configura en el servidor.";
  else if (i.citasSinTarifa > 0) pie = `${plural(i.citasSinTarifa, "cita no suma", "citas no suman")} al total por no tener tarifa configurada.`;

  return (
    <Tarjeta
      Icono={Banknote}
      titulo="Reporte de Ingresos Proyectados Fuera de Horario Laboral"
      valor={i.monto == null ? "—" : dinero(i.monto, moneda)}
      resumen={`${plural(i.citas, "cita agendada", "citas agendadas")} por la IA con la recepción cerrada`}
      variacion={
        tarifasConfiguradas ? (
          <Variacion actual={i.monto} anterior={previo} formatear={(n) => dinero(n, moneda)} />
        ) : null
      }
      pie={pie}
    >
      {i.porEspecialidad.length === 0 ? (
        <p className="text-sm text-[#7D8BA0]">Sin citas fuera de horario en el periodo.</p>
      ) : (
        <ul className="space-y-3">
          {i.porEspecialidad.map((f) => {
            const esp = especialidad(f.especialidad);
            return (
              <Fila
                key={f.especialidad}
                color={esp.color}
                etiqueta={`${esp.nombre} · ${plural(f.citas, "cita", "citas")}`}
                valor={f.monto == null ? "Sin tarifa" : dinero(f.monto, moneda)}
              />
            );
          })}
        </ul>
      )}
    </Tarjeta>
  );
}

export default function MetricasPremium({ impacto }) {
  const premium = impacto.datos?.premium;

  let contenido;
  if (impacto.cargando && !impacto.datos) {
    contenido = <Esqueleto />;
  } else if (impacto.error && !impacto.datos) {
    contenido = (
      <div role="alert" className={`${SUPERFICIE} flex flex-wrap items-center justify-between gap-4 px-6 py-8`}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#E6E9EE]">No se pudieron cargar las métricas premium.</p>
          <p className="mt-1 max-w-md text-sm text-[#A3AEBD]">
            {impacto.error?.status === undefined
              ? "El servidor no respondió. Revisa el indicador de conexión del menú."
              : textoDeError(impacto.error, "El servidor rechazó la consulta. Intenta de nuevo.")}
          </p>
        </div>
        <button type="button" onClick={impacto.recargar} className={`${BOTON_SECUNDARIO} h-8 px-3`}>
          <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Reintentar
        </button>
      </div>
    );
  } else if (!premium) {
    contenido = (
      <div className={`${SUPERFICIE} px-6 py-8`}>
        <p className="text-sm font-medium text-[#E6E9EE]">Las métricas premium aún no están disponibles en el servidor.</p>
        <p className="mt-1 text-sm text-[#A3AEBD]">Se mostrarán aquí en cuanto el servidor las publique.</p>
      </div>
    );
  } else {
    contenido = (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Ausentismo actual={premium.actual} anterior={premium.anterior} />
        <Conversion actual={premium.actual} anterior={premium.anterior} />
        <Ingresos
          actual={premium.actual}
          anterior={premium.anterior}
          moneda={premium.moneda}
          tarifasConfiguradas={premium.tarifasConfiguradas}
        />
      </div>
    );
  }

  return (
    <section aria-labelledby="metricas-premium-titulo">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="metricas-premium-titulo" className="text-base font-semibold text-[#E6E9EE]">
          Métricas premium
        </h2>
        {premium && (
          <p className="text-xs tabular-nums text-[#7D8BA0]">Últimos 7 días · {rango(premium.actual)} · hora de Caracas</p>
        )}
      </div>
      {contenido}
    </section>
  );
}