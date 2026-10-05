import { listarEscaladas } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { FILA, SUPERFICIE, TABLA, TD, TH } from "../ui/estilos";
import { enlaceTel, fechaHora, telefono } from "../ui/formato";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, VacioVista } from "../ui/Vista";

const cargarEscaladas = (signal) => listarEscaladas({ signal });

export default function EscaladasView() {
  const escaladas = useSondeo(cargarEscaladas, { intervaloMs: 60000 });

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Conversaciones escaladas"
        descripcion="Pacientes que el asistente de WhatsApp pasó a una persona. Llama o escribe desde el número de la clínica."
      />
      {escaladas.cargando && !escaladas.datos ? (
        <CargaVista />
      ) : escaladas.error && !escaladas.datos ? (
    <ErrorVista error={escaladas.error} onReintentar={escaladas.recargar} />      ) : (
        <div className={`${SUPERFICIE} overflow-x-auto`}>
          <table className={TABLA}>
            <thead>
              <tr>
                <th scope="col" className={TH}>Teléfono</th>
                <th scope="col" className={TH}>Motivo</th>
                <th scope="col" className={TH}>Recibida</th>
                <th scope="col" className={TH}>Atendida por</th>
              </tr>
            </thead>
            <tbody>
              {escaladas.datos.map((e) => (
                <tr key={e.id} className={FILA}>
                  <td className={`${TD} whitespace-nowrap`}>
                    <a href={enlaceTel(e.telefono)} className="tabular-nums hover:text-white">
                      {telefono(e.telefono)}
                    </a>
                  </td>
                  <td className={`${TD} max-w-xl text-[#C7CCD3]`}>{e.motivo}</td>
                  <td className={`${TD} whitespace-nowrap capitalize tabular-nums text-[#C7CCD3]`}>{fechaHora(e.fecha)}</td>
                  <td className={`${TD} text-[#A3AEBD]`}>{e.atendido_por ?? "Sin asignar"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {escaladas.datos.length === 0 && (
            <VacioVista titulo="No hay conversaciones escaladas.">El asistente resolvió todas las conversaciones por su cuenta.</VacioVista>
          )}
        </div>
      )}
    </ContenedorVista>
  );
}
