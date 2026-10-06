import { createContext, useContext } from "react";

/**
 * Plan, rol y reloj compartidos por todo el panel. Permite que <ErrorVista> convierta un
 * 403 MODULO_PREMIUM en <BloqueoPremium> sin que cada vista tenga que pasarle props.
 */
const Contexto = createContext(null);

export const ProveedorPlan = Contexto.Provider;

export function usePlanPanel() {
  return useContext(Contexto) ?? { plan: null, rol: null, ahora: Date.now() };
}