/**
 * Calendario semanal de un doctor, agrupado por color de especialidad.
 *
 *   ┌──────┬──────────┬──────────┬──────────┐
 *   │      │ lun 28   │ mar 29   │ mié 30   │   cabecera fija; hoy en platino
 *   ├──────┼──────────┼──────────┼──────────┤
 *   │ 08   │▌Pediatría│          │          │   bloque: tinte 14 % + filete de 2 px del color
 *   │ 09   │          │▌Neuro ▌Neuro ▌+5    │   solapes → hasta 4 carriles; el resto en "+N"
 *   └──────┴──────────┴──────────┴──────────┘
 * La rejilla necesita ≈ 3.5rem + N × 8.5rem; si no cabe, se desplaza dentro de su propio marco.
 * Toda coordenada se acota a la retícula: ningún dato produce anchos, altos ni posiciones inválidos.
 */
import { useMemo, useState } from "react";
import { FOCO } from "../workspace/tokens";
import { ORDEN_ESPECIALIDADES, especialidad } from "../workspace/especialidades";
import { diaEnZona } from "../workspace/agenda";
import { maquetarSemana, partesEnZona, resumenPorEspecialidad } from "./semana";
import BotonRecordatorio from "../workspace/BotonRecordatorio";

const PX_POR_MIN = 1.2; // 72 px por hora: una cita de 30 min deja dos líneas legibles
const ANCHO_COLUMNA = "8.5rem";
const ALTO_MINIMO_BLOQUE = 22;
const COLOR_RESPALDO = "#7D8BA0";

const fmtCabecera = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", weekday: "short", day: "numeric" });
const fmtDiaLargo = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const aFecha = (dia) => new Date(`${dia}T12:00:00Z`);

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function conAlfa(hex, alfa) {
  const color = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : COLOR_RESPALDO;
  const n = Number.parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

/** left/width del carril. Acotado: nunca divide por cero ni sale de la columna. */
function posicionCarril(carril, carriles) {
  const total = Number.isInteger(carriles) && carriles > 0 ? carriles : 1;
  const indice = Number.isInteger(carril) ? Math.min(Math.max(carril, 0), total - 1) : 0;
  const ancho = 100 / total;
  return { left: `calc(${indice * ancho}% + 2px)`, width: `calc(${ancho}% - 4px)` };
}

/** top/height dentro de la retícula: una cita de las 23:50 no se sale por abajo. */
function geometriaVertical(inicioBloque, finBloque, inicioGrid, altoGrid) {
  const alto = Math.min(altoGrid, Math.max(ALTO_MINIMO_BLOQUE, (finBloque - inicioBloque) * PX_POR_MIN - 2));
  const top = Math.min(Math.max(0, (inicioBloque - inicioGrid) * PX_POR_MIN + 1), Math.max(0, altoGrid - alto));
  return { top, height: alto };
}

function Leyenda({ resumen, ocultas, onAlternar }) {
  const conteo = new Map(resumen.map((r) => [r.codigo, r.total]));
  const codigos = [...ORDEN_ESPECIALIDADES, ...resumen.map((r) => r.codigo).filter((c) => !ORDEN_ESPECIALIDADES.includes(c))];
  return (
    <div role="group" aria-label="Mostrar u ocultar especialidades" className="flex flex-wrap items-center gap-2">
      {codigos.map((codigo) => {
        const esp = especialidad(codigo);
        const visible = !ocultas.has(codigo);
        const total = conteo.get(codigo) ?? 0;
        return (
          <button
            key={codigo}
            type="button"
            aria-pressed={visible}
            onClick={() => onAlternar(codigo)}
            className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs transition-colors duration-200 ${FOCO} ${
              visible ? "border-[#2A4266] text-[#E6E9EE] hover:border-[#3A4F6E]" : "border-[#1A2D48] text-[#7D8BA0] hover:text-[#A3AEBD]"
            }`}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full border"
              style={{ backgroundColor: visible ? esp.color : "transparent", borderColor: esp.color }}
            />
            {esp.nombre}
            <span className="tabular-nums text-[#7D8BA0]">{total}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Bloque de cita. Las citas confirmadas y futuras de 30 min o más llevan el recordatorio en
 * versión "mini"; en 15 min no cabe sin tapar el nombre del paciente.
 * recordatorio: null (no se muestra) | boolean (módulo de notificaciones habilitado)
 */
function Bloque({ b, inicioMin, altoGrid, unificada, ahora, recordatorio }) {
  const esp = especialidad(b.especialidad);
  const { top, height } = geometriaVertical(b.inicioMin, b.finMin, inicioMin, altoGrid);
  const inasistente = b.estado === "no_show";
  const conRecordatorio =
    recordatorio != null && b.estado === "confirmada" && height >= 34 && Date.parse(b.inicioIso) > ahora;

  return (
    <li
      className={`absolute overflow-hidden rounded-[4px] border border-l-2 px-2 py-1 text-[11px] leading-tight text-[#E6E9EE] ${
        inasistente ? "opacity-55" : ""
      } ${conRecordatorio ? "pr-10" : ""}`}
      style={{
        top,
        height,
        ...posicionCarril(b.carril, b.carriles),
        backgroundColor: conAlfa(esp.color, 0.14),
        borderColor: conAlfa(esp.color, 0.4),
        borderLeftColor: esp.color,
      }}
    >
      <p className="tabular-nums text-[#C7CCD3]">
        {hhmm(b.inicioMin)}
        <span className="sr-only">
          {" "}
          a {hhmm(b.finMin)}, {esp.nombre}
        </span>
        {inasistente && <span className="ml-1.5 text-[#E8A9A9]">Inasistente</span>}
      </p>
      <p className={`truncate font-medium ${inasistente ? "line-through" : ""}`}>{b.paciente ?? "Paciente"}</p>
      {unificada && height > 44 && <p className="truncate text-[#A3AEBD]">{b.doctor}</p>}
      {conRecordatorio && (
        <BotonRecordatorio
          citaId={b.id}
          paciente={b.paciente}
          habilitado={recordatorio}
          variante="mini"
          className="absolute right-1 top-1"
        />
      )}
    </li>
  );
}

/** "+N": citas de una franja que no caben en los carriles visibles. */
function Excedente({ x, inicioMin, altoGrid }) {
  const { top, height } = geometriaVertical(x.inicioMin, x.finMin, inicioMin, altoGrid);
  const lista = x.detalle.map((d) => `${hhmm(d.inicioMin)} ${d.paciente ?? "Paciente"}`).join(", ");
  const resto = x.cantidad - x.detalle.length;
  const descripcion = resto > 0 ? `${lista} y ${resto} más` : lista;
  return (
    <li
      title={descripcion}
      className="absolute flex justify-center rounded-[4px] border border-dashed border-[#3A4F6E] bg-[#0B192C]/80 px-1 py-1 text-[11px] font-medium tabular-nums text-[#E6E9EE]"
      style={{ top, height, ...posicionCarril(x.carril, x.carriles) }}
    >
      <span aria-hidden>+{x.cantidad}</span>
      <span className="sr-only">
        {x.cantidad} {x.cantidad === 1 ? "cita más" : "citas más"} entre {hhmm(x.inicioMin)} y {hhmm(x.finMin)}: {descripcion}
      </span>
    </li>
  );
}

/**
 * @param {{ citas: object[], doctorId: number|null, horario?: object, lunes: string, ahora: number, unificada?: boolean }} props
 *   doctorId null + unificada = Multi-Calendario (solo con el módulo activo).
 */
export default function CalendarioDoctor({
  citas,
  doctorId,
  horario,
  lunes,
  ahora,
  unificada = false,
  notificacionesHabilitadas = false,
  puedeRecordar = false,
}) {
  const [ocultas, setOcultas] = useState(() => new Set());

  const m = useMemo(
    () => maquetarSemana(citas, { doctorId: unificada ? null : doctorId, lunes, horario, ocultas }),
    [citas, doctorId, unificada, lunes, horario, ocultas],
  );
  const resumen = useMemo(() => resumenPorEspecialidad(m.citasSemana), [m.citasSemana]);

  const alternar = (codigo) =>
    setOcultas((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(codigo)) siguiente.delete(codigo);
      else siguiente.add(codigo);
      return siguiente;
    });

  const hoy = diaEnZona(ahora);
  const ahoraMin = partesEnZona(ahora).minutos;
  const alto = Math.max(60, (m.finMin - m.inicioMin) * PX_POR_MIN);
  const horas = [];
  // Tope de 24 marcas: una ventana corrupta nunca produce un bucle largo.
  for (let h = m.inicioMin; h < m.finMin && horas.length < 24; h += 60) horas.push(h);
  const columnas = { gridTemplateColumns: `3.5rem repeat(${m.columnas.length}, minmax(${ANCHO_COLUMNA}, 1fr))` };

  return (
    <div>
      <Leyenda resumen={resumen} ocultas={ocultas} onAlternar={alternar} />

      <div className="relative mt-4 overflow-x-auto rounded-[10px] border border-[#1A2D48] bg-[#0E1F36]/90">
        {/* Cabecera */}
        <div className="grid border-b border-[#1A2D48]" style={columnas}>
          <span aria-hidden />
          {m.columnas.map((c) => {
            const esHoy = c.dia === hoy;
            return (
              <div key={c.dia} className="border-l border-[#1A2D48] px-3 py-3">
                <p className={`text-sm capitalize ${esHoy ? "font-semibold text-[#F2F4F7]" : "text-[#A3AEBD]"}`}>
                  {fmtCabecera.format(aFecha(c.dia))}
                  {esHoy && <span className="ml-2 text-xs font-normal text-[#86D5BC]">Hoy</span>}
                </p>
                {!c.laborable && <p className="mt-0.5 text-[11px] text-[#7D8BA0]">Fuera de horario</p>}
              </div>
            );
          })}
        </div>

        {/* Cuerpo */}
        <div className="grid" style={columnas}>
          <div aria-hidden className="relative" style={{ height: alto }}>
            {horas.map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[#7D8BA0] first:translate-y-0"
                style={{ top: (h - m.inicioMin) * PX_POR_MIN }}
              >
                {hhmm(h)}
              </span>
            ))}
          </div>

          {m.columnas.map((c) => {
            const totalDia = c.bloques.length + c.excedentes.reduce((n, x) => n + x.cantidad, 0);
            return (
              <div
                key={c.dia}
                className={`relative overflow-hidden border-l border-[#1A2D48] ${c.laborable ? "" : "bg-[#0B192C]/50"}`}
                style={{ height: alto }}
              >
                {horas.slice(1).map((h) => (
                  <span
                    key={h}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-[#1A2D48]/70"
                    style={{ top: (h - m.inicioMin) * PX_POR_MIN }}
                  />
                ))}

                {c.dia === hoy && ahoraMin >= m.inicioMin && ahoraMin <= m.finMin && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 z-10 border-t border-[#E6E9EE]"
                    style={{ top: (ahoraMin - m.inicioMin) * PX_POR_MIN }}
                  >
                    <span className="absolute -left-[3px] -top-[3.5px] h-1.5 w-1.5 rounded-full bg-[#E6E9EE]" />
                  </span>
                )}

                <ol aria-label={`${fmtDiaLargo.format(aFecha(c.dia))}: ${totalDia} citas`} className="absolute inset-0">
                  {c.bloques.map((b) => (
                    <Bloque
                      key={String(b.id)}
                      b={b}
                      inicioMin={m.inicioMin}
                      altoGrid={alto}
                      unificada={unificada}
                      ahora={ahora}
                      recordatorio={puedeRecordar ? notificacionesHabilitadas : null}
                    />
                  ))}
                  {c.excedentes.map((x) => (
                    <Excedente key={x.id} x={x} inicioMin={m.inicioMin} altoGrid={alto} />
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        {m.total === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-[#A3AEBD]">
            Sin citas esta semana.
          </p>
        )}
      </div>

      {m.canceladas > 0 && (
        <p className="mt-3 text-xs text-[#7D8BA0]">
          {m.canceladas === 1 ? "1 cita cancelada no se muestra." : `${m.canceladas} citas canceladas no se muestran.`}
        </p>
      )}
    </div>
  );
}