import { useMemo, useState } from "react";
import { Loader2, MessageCircle, Search, Send } from "lucide-react";
import { cancelarCita, enviarRecordatorioManual, marcarNoShow, textoDeError } from "../../../api/panel";
import { candidatasRecordatorio, filtrarCitas } from "../citas/filtros";
import { MENSAJES, MODULO, estadoModulo } from "../plan/plan";
import { ESPECIALIDADES, ORDEN_ESPECIALIDADES, especialidad } from "../workspace/especialidades";
import {
  BOTON_FANTASMA,
  BOTON_PELIGRO,
  BOTON_PRIMARIO,
  BOTON_SECUNDARIO,
  CAMPO,
  FILA,
  SUPERFICIE,
  TABLA,
  TD,
  TH,
} from "../ui/estilos";
import { enlaceTel, fechaHora, telefono } from "../ui/formato";
import { BotonBloqueado } from "../ui/Premium";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado, VacioVista } from "../ui/Vista";

const ETIQUETA_RECORDATORIO = "Lanzar Recordatorio Manual WhatsApp / Correo";

const ESTADOS = {
  confirmada: { nombre: "Confirmada", clase: "border-[#2C5B53] text-[#86D5BC]" },
  completada: { nombre: "Completada", clase: "border-[#2A4266] text-[#A3AEBD]" },
  no_show: { nombre: "No-show", clase: "border-[#4A4230] text-[#C9AE72]" },
  cancelada: { nombre: "Cancelada", clase: "border-[#1A2D48] text-[#7D8BA0]" },
};

const PERIODOS = [
  { id: "proximas", nombre: "Próximas" },
  { id: "pasadas", nombre: "Pasadas" },
  { id: "todas", nombre: "Todas" },
];

function PildoraEstado({ estado }) {
  const e = ESTADOS[estado] ?? { nombre: estado, clase: "border-[#1A2D48] text-[#A3AEBD]" };
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs ${e.clase}`}>{e.nombre}</span>;
}

/**
 * Recordatorio manual. Bloqueado: candado + tooltip con el mensaje de Astra.
 * Con el módulo activo: envía a las confirmadas futuras de la lista visible, tras confirmar.
 */
function RecordatorioManual({ habilitado, destinatarias, onResultado }) {
  const [fase, setFase] = useState("inactivo"); // inactivo | confirmar | enviando

  if (!habilitado) {
    return <BotonBloqueado etiqueta={ETIQUETA_RECORDATORIO} motivo={MENSAJES[MODULO.NOTIFICACIONES]} Icono={Send} />;
  }

  const enviar = async () => {
    setFase("enviando");
    const resultados = await Promise.allSettled(destinatarias.map((c) => enviarRecordatorioManual(c.id)));
    const fallidos = resultados.filter((r) => r.status === "rejected").length;
    const enviados = resultados.length - fallidos;
    setFase("inactivo");
    onResultado(
      fallidos === 0
        ? { tipo: "ok", texto: `Recordatorio enviado a ${enviados} ${enviados === 1 ? "paciente" : "pacientes"}.` }
        : { tipo: "error", texto: `Se enviaron ${enviados} y fallaron ${fallidos}. Revisa la conexión y vuelve a lanzar.` },
    );
  };

  if (fase === "confirmar" || fase === "enviando") {
    const n = destinatarias.length;
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={enviar} disabled={fase === "enviando"} className={BOTON_PRIMARIO}>
          {fase === "enviando" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
          {fase === "enviando" ? "Enviando…" : `Enviar a ${n} ${n === 1 ? "paciente" : "pacientes"}`}
        </button>
        {fase === "confirmar" && (
          <button type="button" onClick={() => setFase("inactivo")} className={BOTON_SECUNDARIO}>
            Cancelar
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setFase("confirmar")}
      disabled={destinatarias.length === 0}
      title={destinatarias.length === 0 ? "No hay citas confirmadas próximas en la lista" : undefined}
      className={BOTON_SECUNDARIO}
    >
      <Send aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      {ETIQUETA_RECORDATORIO}
    </button>
  );
}

function AccionesCita({ cita, ocupada, confirmando, onPedirCancelar, onSoltar, onAccion }) {
  if (cita.estado !== "confirmada") return null;
  if (confirmando) {
    return (
      <div className="flex justify-end gap-1.5">
        <button type="button" disabled={ocupada} onClick={() => onAccion(cita, "cancelar")} className={BOTON_PELIGRO}>
          {ocupada ? "Cancelando…" : "Confirmar cancelación"}
        </button>
        <button type="button" disabled={ocupada} onClick={onSoltar} className={BOTON_FANTASMA}>
          No
        </button>
      </div>
    );
  }
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" disabled={ocupada} onClick={() => onAccion(cita, "no-show")} className={BOTON_FANTASMA}>
        No-show
      </button>
      <button type="button" disabled={ocupada} onClick={() => onPedirCancelar(cita.id)} className={BOTON_FANTASMA}>
        Cancelar
      </button>
    </div>
  );
}

export default function CitasView({ citas, plan, ahora, rol }) {
  const [filtros, setFiltros] = useState({ periodo: "proximas", estado: "", especialidad: "", texto: "" });
  const [confirmando, setConfirmando] = useState(null);
  const [ocupada, setOcupada] = useState(null);
  const [resultado, setResultado] = useState(null);

  const lista = useMemo(() => filtrarCitas(citas.datos, filtros, ahora), [citas.datos, filtros, ahora]);
  const destinatarias = useMemo(() => candidatasRecordatorio(lista, ahora), [lista, ahora]);
  const notificaciones = estadoModulo(plan.datos, MODULO.NOTIFICACIONES, ahora);
  const puedeRecordar = rol === "recepcion" || rol === "direccion";

  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  const ejecutar = async (cita, accion) => {
    setOcupada(cita.id);
    setResultado(null);
    try {
      if (accion === "cancelar") await cancelarCita(cita.id);
      else await marcarNoShow(cita.id);
      setResultado({
        tipo: "ok",
        texto: `${accion === "cancelar" ? "Cita cancelada" : "Marcada como no-show"}: ${cita.paciente_nombre}, ${fechaHora(cita.fecha_hora_inicio)}.`,
      });
      setConfirmando(null);
      citas.recargar();
    } catch (err) {
      setResultado({ tipo: "error", texto: textoDeError(err) });
    } finally {
      setOcupada(null);
    }
  };

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Citas"
        descripcion={rol === "doctor" ? "Tu agenda completa." : "Todas las citas de la clínica, de las cuatro especialidades."}
      >
        {puedeRecordar && (
          <RecordatorioManual habilitado={notificaciones.habilitado} destinatarias={destinatarias} onResultado={setResultado} />
        )}
      </EncabezadoVista>

      <p className="mb-6 flex items-center gap-2 text-sm text-[#A3AEBD]">
        <MessageCircle aria-hidden className="h-4 w-4 text-[#86D5BC]" strokeWidth={1.75} />
        Cada cita que se agenda se notifica al paciente por WhatsApp en ese mismo momento.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Periodo" className="inline-flex rounded-md border border-[#1E3350] p-0.5">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={filtros.periodo === p.id}
              onClick={() => setFiltros((f) => ({ ...f, periodo: p.id }))}
              className={`h-8 cursor-pointer rounded-[5px] px-3 text-sm transition-colors duration-200 ${
                filtros.periodo === p.id ? "bg-[#E6E9EE] font-medium text-[#0B192C]" : "text-[#A3AEBD] hover:text-[#E6E9EE]"
              }`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
        <label className="w-44">
          <span className="sr-only">Estado</span>
          <select value={filtros.estado} onChange={cambiar("estado")} className={`${CAMPO} cursor-pointer`}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS).map(([id, e]) => (
              <option key={id} value={id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="w-52">
          <span className="sr-only">Especialidad</span>
          <select value={filtros.especialidad} onChange={cambiar("especialidad")} className={`${CAMPO} cursor-pointer`}>
            <option value="">Todas las especialidades</option>
            {ORDEN_ESPECIALIDADES.map((codigo) => (
              <option key={codigo} value={codigo}>
                {ESPECIALIDADES[codigo].nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="relative w-64">
          <span className="sr-only">Buscar paciente o teléfono</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#7D8BA0]" />
          <input
            type="search"
            value={filtros.texto}
            onChange={cambiar("texto")}
            placeholder="Paciente o teléfono"
            className={`${CAMPO} pl-9`}
          />
        </label>
        <div className="ml-auto min-h-5">
          <Resultado resultado={resultado} />
        </div>
      </div>

      {citas.cargando && !citas.datos ? (
        <CargaVista />
      ) : citas.error && !citas.datos ? (
        <ErrorVista onReintentar={citas.recargar} />
      ) : (
        <div className={`${SUPERFICIE} overflow-x-auto`}>
          <table className={TABLA}>
            <caption className="sr-only">Citas filtradas: {lista.length}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Paciente</th>
                <th scope="col" className={TH}>Especialidad</th>
                <th scope="col" className={TH}>Doctor</th>
                <th scope="col" className={TH}>Fecha</th>
                <th scope="col" className={TH}>Estado</th>
                <th scope="col" className={`${TH} text-right`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const esp = especialidad(c.especialidad_codigo);
                return (
                  <tr key={c.id} className={FILA}>
                    <td className={TD}>
                      <p className="font-medium">{c.paciente_nombre}</p>
                      <a href={enlaceTel(c.paciente_telefono)} className="text-xs tabular-nums text-[#7D8BA0] hover:text-[#E6E9EE]">
                        {telefono(c.paciente_telefono)}
                      </a>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: esp.color }} />
                        {c.especialidad_nombre ?? esp.nombre}
                      </span>
                    </td>
                    <td className={`${TD} text-[#C7CCD3]`}>{c.doctor_nombre}</td>
                    <td className={`${TD} whitespace-nowrap capitalize tabular-nums text-[#C7CCD3]`}>{fechaHora(c.fecha_hora_inicio)}</td>
                    <td className={TD}>
                      <PildoraEstado estado={c.estado} />
                    </td>
                    <td className={`${TD} w-px whitespace-nowrap`}>
                      <AccionesCita
                        cita={c}
                        ocupada={ocupada === c.id}
                        confirmando={confirmando === c.id}
                        onPedirCancelar={setConfirmando}
                        onSoltar={() => setConfirmando(null)}
                        onAccion={ejecutar}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lista.length === 0 && (
            <VacioVista titulo="No hay citas con estos filtros.">Cambia el periodo o limpia la búsqueda.</VacioVista>
          )}
        </div>
      )}
    </ContenedorVista>
  );
}
