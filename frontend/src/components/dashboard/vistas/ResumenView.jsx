import { useMemo } from "react";
import { obtenerMetricas } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { diaEnZona } from "../workspace/agenda";
import { ORDEN_ESPECIALIDADES, especialidad } from "../workspace/especialidades";
import { SUPERFICIE } from "../ui/estilos";
import { hora } from "../ui/formato";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista } from "../ui/Vista";

const cargarMetricas = (signal) => obtenerMetricas({ signal });

function Cifra({ etiqueta, valor, nota }) {
  return (
    <div className="px-6 py-6">
      <dt className="text-sm text-[#A3AEBD]">{etiqueta}</dt>
      <dd className="mt-3 text-[2rem] font-medium leading-none tracking-tight tabular-nums text-[#F2F4F7]">{valor}</dd>
      {nota && <dd className="mt-2 text-xs text-[#7D8BA0]">{nota}</dd>}
    </div>
  );
}

/** Citas confirmadas de hoy agrupadas por especialidad, con la siguiente hora pendiente. */
function agruparHoy(citas, ahora) {
  const hoy = diaEnZona(ahora);
  const grupos = new Map();
  for (const c of citas ?? []) {
    const inicio = Date.parse(c.fecha_hora_inicio);
    if (c.estado !== "confirmada" || !Number.isFinite(inicio) || diaEnZona(inicio) !== hoy) continue;
    const g = grupos.get(c.especialidad_codigo) ?? { total: 0, siguiente: null };
    g.total += 1;
    if (inicio >= ahora && (g.siguiente == null || inicio < g.siguiente)) g.siguiente = inicio;
    grupos.set(c.especialidad_codigo, g);
  }
  return ORDEN_ESPECIALIDADES.map((codigo) => ({ codigo, ...(grupos.get(codigo) ?? { total: 0, siguiente: null }) }));
}

export default function ResumenView({ rol, citas, ahora }) {
  const metricas = useSondeo(cargarMetricas, { intervaloMs: 60000 });
  const hoy = useMemo(() => agruparHoy(citas, ahora), [citas, ahora]);
  const m = metricas.datos;
  const esDoctor = rol === "doctor";

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Resumen"
        descripcion={esDoctor ? "Tu agenda de un vistazo." : "Actividad de la clínica en las cuatro especialidades."}
      />

      {metricas.cargando && !m ? (
        <CargaVista filas={2} />
      ) : metricas.error && !m ? (
        <ErrorVista error={metricas.error} onReintentar={metricas.recargar} />
      ) : (
        <dl className={`${SUPERFICIE} grid grid-cols-1 divide-y divide-[#1A2D48] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x`}>
          <Cifra etiqueta={esDoctor ? "Citas en tu agenda" : "Citas registradas"} valor={m.total_citas} />
          <Cifra etiqueta="Confirmadas activas" valor={m.confirmadas} />
          <Cifra
            etiqueta="Tasa de Ausentismo"
            valor={`${m.tasa_no_show}%`}
            nota={`${m.no_show} ${m.no_show === 1 ? "paciente inasistente" : "pacientes inasistentes"} de ${m.total_citas} citas`}
          />          {m.conversaciones_escaladas != null && (
            <Cifra etiqueta="Escaladas a un asesor" valor={m.conversaciones_escaladas} />
          )}
        </dl>
      )}

      <section aria-labelledby="hoy-titulo" className="mt-10">
        <h2 id="hoy-titulo" className="text-base font-semibold text-[#E6E9EE]">
          Hoy por especialidad
        </h2>
        <ul className={`${SUPERFICIE} mt-4 divide-y divide-[#1A2D48]`}>
          {hoy.map(({ codigo, total, siguiente }) => {
            const esp = especialidad(codigo);
            return (
              <li key={codigo} className="flex items-center gap-4 px-5 py-4">
                <span aria-hidden className="h-6 w-px" style={{ backgroundColor: esp.color }} />
                <span className="w-32 text-sm text-[#E6E9EE]">{esp.nombre}</span>
                <span className="text-sm tabular-nums text-[#A3AEBD]">
                  {total === 0 ? "Sin citas" : total === 1 ? "1 cita" : `${total} citas`}
                </span>
                <span className="ml-auto text-sm tabular-nums text-[#7D8BA0]">
                  {siguiente ? `Siguiente a las ${hora(siguiente)}` : total > 0 ? "Sin pendientes" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </ContenedorVista>
  );
}
