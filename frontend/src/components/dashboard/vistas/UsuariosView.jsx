/**
 * Usuarios del panel (solo Dirección) con el tope de operadores del plan.
 * Con el cupo lleno, el formulario queda deshabilitado con el mensaje de Soluciones Astra y
 * "Activar" se bloquea. El servidor y el trigger de la BD lo imponen igual (403 LIMITE_OPERADORES).
 */
import { useId, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { actualizarUsuario, crearUsuario, listarUsuarios, restablecerClave, textoDeError } from "../../../api/panel";
import { useSondeo } from "../../../hooks/useSondeo";
import { MENSAJES, cupoOperadores } from "../plan/plan";
import { BOTON_FANTASMA, BOTON_PRIMARIO, CAMPO, ETIQUETA, FILA, SUPERFICIE, TABLA, TD, TH } from "../ui/estilos";
import { BotonBloqueado, SelloCandado } from "../ui/Premium";
import { CargaVista, ContenedorVista, EncabezadoVista, ErrorVista, Resultado } from "../ui/Vista";

const ROLES = { recepcion: "Recepción", direccion: "Dirección", doctor: "Doctor" };
const VACIO = { nombre: "", email: "", password: "", rol: "", doctor_id: "" };
const cargarUsuarios = (signal) => listarUsuarios({ signal });

function MedidorCupo({ cupo }) {
  if (!cupo.conocido) return null;
  const segmentos = Math.max(cupo.maximo, cupo.activos);
  return (
    <div className="min-w-[13rem]">
      <p className="text-sm text-[#E6E9EE]">
        <span className="tabular-nums">
          {cupo.activos} de {cupo.maximo}
        </span>{" "}
        operadores activos
      </p>
      <div aria-hidden className="mt-2 flex gap-1">
        {Array.from({ length: segmentos }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i >= cupo.maximo ? "bg-[#E8A9A9]" : i < cupo.activos ? "bg-[#E6E9EE]" : "bg-[#1A2D48]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function FormularioAlta({ cupo, doctores, onCreado, onLimite }) {
  const [campos, setCampos] = useState(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const bloqueado = cupo.lleno;
  const avisoId = useId();

  const cambiar = (campo) => (e) => setCampos((c) => ({ ...c, [campo]: e.target.value }));

  const enviar = async (e) => {
    e.preventDefault();
    if (bloqueado) return;
    setEnviando(true);
    setResultado(null);
    try {
      await crearUsuario({ ...campos, doctor_id: campos.rol === "doctor" ? Number(campos.doctor_id) : null });
      setResultado({ tipo: "ok", texto: `Usuario creado: ${campos.nombre}.` });
      setCampos(VACIO);
      onCreado();
    } catch (err) {
      if (err?.code === "LIMITE_OPERADORES") onLimite();
      setResultado({ tipo: "error", texto: textoDeError(err) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section aria-labelledby="alta-titulo" className={`${SUPERFICIE} p-6`}>
      <h2 id="alta-titulo" className="flex items-center gap-2 text-base font-semibold text-[#E6E9EE]">
        <UserPlus aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        Registrar operador
      </h2>

      {bloqueado && (
        <div id={avisoId} role="alert" className="mt-5 flex items-start gap-4 rounded-lg border border-[#243B5A] bg-[#0B192C]/80 p-5 backdrop-blur-md">
          <SelloCandado />
          <div>
            <p className="text-[15px] leading-relaxed text-[#E6E9EE]">{MENSAJES.LIMITE_OPERADORES}</p>
            {cupo.excedente > 0 && (
              <p className="mt-2 text-sm text-[#A3AEBD]">
                Hoy hay {cupo.excedente} {cupo.excedente === 1 ? "cuenta activa" : "cuentas activas"} por encima del plan. Desactiva
                las que no se usen.
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={enviar} aria-describedby={bloqueado ? avisoId : undefined} className="mt-5">
        <fieldset disabled={bloqueado || enviando} className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_11rem_auto] xl:items-end ${bloqueado ? "opacity-50" : ""}`}>
          <label>
            <span className={ETIQUETA}>Nombre</span>
            <input required value={campos.nombre} onChange={cambiar("nombre")} autoComplete="off" className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Correo</span>
            <input required type="email" value={campos.email} onChange={cambiar("email")} autoComplete="off" className={CAMPO} />
          </label>
          <label>
            <span className={ETIQUETA}>Contraseña inicial</span>
            <input
              required
              type="password"
              minLength={6}
              value={campos.password}
              onChange={cambiar("password")}
              autoComplete="new-password"
              placeholder="Mínimo 6 caracteres"
              className={CAMPO}
            />
          </label>
          <label>
            <span className={ETIQUETA}>Rol</span>
            <select required value={campos.rol} onChange={cambiar("rol")} className={`${CAMPO} cursor-pointer`}>
              <option value="">Elegir rol</option>
              {Object.entries(ROLES).map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          {campos.rol === "doctor" && (
            <label className="xl:col-start-4">
              <span className={ETIQUETA}>Doctor asociado</span>
              <select required value={campos.doctor_id} onChange={cambiar("doctor_id")} className={`${CAMPO} cursor-pointer`}>
                <option value="">Elegir doctor</option>
                {doctores.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={`${BOTON_PRIMARIO} xl:row-start-1 xl:col-start-5`}>
            {enviando ? "Creando…" : "Crear usuario"}
          </button>
        </fieldset>
      </form>

      <div className="mt-4 min-h-5">
        <Resultado resultado={resultado} />
      </div>
    </section>
  );
}

function FilaUsuario({ u, esYo, cupoLleno, doctores, onCambio, onLimite }) {
  const [rol, setRol] = useState(u.rol);
  const [doctorId, setDoctorId] = useState(u.doctor_id ?? "");
  const [clave, setClave] = useState(null); // null = cerrado
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null);
  const modificado = rol !== u.rol || (rol === "doctor" && Number(doctorId) !== u.doctor_id);

  const ejecutar = async (accion, exito) => {
    setOcupado(true);
    setResultado(null);
    try {
      await accion();
      setResultado({ tipo: "ok", texto: exito });
      onCambio();
      return true;
    } catch (err) {
      if (err?.code === "LIMITE_OPERADORES") onLimite();
      setResultado({ tipo: "error", texto: textoDeError(err) });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const guardar = (activo) =>
    ejecutar(
      () => actualizarUsuario(u.id, { nombre: u.nombre, rol, doctor_id: rol === "doctor" ? Number(doctorId) : null, activo }),
      activo === u.activo ? "Cambios guardados." : activo ? "Cuenta activada." : "Cuenta desactivada.",
    );

  return (
    <>
      <tr className={FILA}>
        <td className={TD}>
          <p className="font-medium">
            {u.nombre}
            {esYo && <span className="ml-2 text-xs font-normal text-[#7D8BA0]">(tú)</span>}
          </p>
          <p className="text-xs text-[#7D8BA0]">{u.email}</p>
        </td>
        <td className={TD}>
          <select
            aria-label={`Rol de ${u.nombre}`}
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            disabled={ocupado}
            className={`${CAMPO} h-8 w-36 cursor-pointer`}
          >
            {Object.entries(ROLES).map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </td>
        <td className={TD}>
          {rol === "doctor" ? (
            <select
              aria-label={`Doctor asociado a ${u.nombre}`}
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              disabled={ocupado}
              className={`${CAMPO} h-8 w-44 cursor-pointer`}
            >
              <option value="">Elegir doctor</option>
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[#7D8BA0]">No aplica</span>
          )}
        </td>
        <td className={TD}>
          {u.activo ? <span className="text-[#86D5BC]">Activa</span> : <span className="text-[#7D8BA0]">Inactiva</span>}
        </td>
        <td className={`${TD} w-px whitespace-nowrap`}>
          <div className="flex items-center justify-end gap-1.5">
            {modificado && (
              <button type="button" onClick={() => guardar(u.activo)} disabled={ocupado || (rol === "doctor" && !doctorId)} className={BOTON_FANTASMA}>
                Guardar
              </button>
            )}
            {u.activo ? (
              <button
                type="button"
                onClick={() => guardar(false)}
                disabled={ocupado || esYo}
                title={esYo ? "No puedes desactivar tu propia cuenta" : undefined}
                className={BOTON_FANTASMA}
              >
                Desactivar
              </button>
            ) : cupoLleno ? (
              <BotonBloqueado etiqueta="Activar" motivo={MENSAJES.LIMITE_OPERADORES} />
            ) : (
              <button type="button" onClick={() => guardar(true)} disabled={ocupado} className={BOTON_FANTASMA}>
                Activar
              </button>
            )}
            <button
              type="button"
              aria-expanded={clave != null}
              onClick={() => setClave((c) => (c == null ? "" : null))}
              disabled={ocupado}
              className={BOTON_FANTASMA}
            >
              <KeyRound aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
              Restablecer clave
            </button>
          </div>
        </td>
      </tr>
      {(clave != null || resultado) && (
        <tr>
          <td colSpan={5} className="border-b border-[#1A2D48] bg-[#0B192C]/40 px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {clave != null && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    ejecutar(() => restablecerClave(u.id, clave), "Contraseña actualizada.").then((ok) => ok && setClave(null));
                  }}
                  className="flex items-center gap-2"
                >
                  <label>
                    <span className="sr-only">Nueva contraseña para {u.nombre}</span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      placeholder="Nueva contraseña (mín. 6)"
                      value={clave}
                      onChange={(e) => setClave(e.target.value)}
                      className={`${CAMPO} h-8 w-60`}
                    />
                  </label>
                  <button type="submit" disabled={ocupado} className={`${BOTON_PRIMARIO} h-8 px-3`}>
                    Guardar contraseña
                  </button>
                  <button type="button" onClick={() => setClave(null)} className={BOTON_FANTASMA}>
                    Cancelar
                  </button>
                </form>
              )}
              <Resultado resultado={resultado} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function UsuariosView({ plan, doctores, usuarioActual }) {
  const usuarios = useSondeo(cargarUsuarios);
  const cupo = cupoOperadores(plan.datos);
  const listaDoctores = doctores.datos ?? [];

  const refrescar = () => {
    usuarios.recargar();
    plan.recargar();
  };

  return (
    <ContenedorVista>
      <EncabezadoVista
        id="titulo-vista"
        titulo="Usuarios del panel"
        descripcion="Cada persona entra con su propia cuenta. El plan incluye los operadores de Recepción y Dirección."
      >
        <MedidorCupo cupo={cupo} />
      </EncabezadoVista>

      <FormularioAlta cupo={cupo} doctores={listaDoctores} onCreado={refrescar} onLimite={plan.recargar} />

      <div className="mt-10">
        {usuarios.cargando && !usuarios.datos ? (
          <CargaVista filas={3} />
        ) : usuarios.error && !usuarios.datos ? (
          <ErrorVista detalle={textoDeError(usuarios.error)} onReintentar={usuarios.recargar} />
        ) : (
          <div className={`${SUPERFICIE} overflow-x-auto`}>
            <table className={TABLA}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Usuario</th>
                  <th scope="col" className={TH}>Rol</th>
                  <th scope="col" className={TH}>Doctor asociado</th>
                  <th scope="col" className={TH}>Estado</th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usuarios.datos.map((u) => (
                  <FilaUsuario
                    key={u.id}
                    u={u}
                    esYo={u.id === usuarioActual?.id}
                    cupoLleno={cupo.lleno}
                    doctores={listaDoctores}
                    onCambio={refrescar}
                    onLimite={plan.recargar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ContenedorVista>
  );
}
