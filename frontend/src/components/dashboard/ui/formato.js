/** Formatos de fecha/hora del panel: siempre en la hora de la clínica, nunca en la del navegador. */
import { ZONA_CLINICA } from "../workspace/agenda";

const fmtFechaHora = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fmtFechaLarga = new Intl.DateTimeFormat("es-VE", {
  timeZone: ZONA_CLINICA,
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fmtHora = new Intl.DateTimeFormat("es-VE", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const valido = (v) => {
  const ms = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

export const fechaHora = (v) => (valido(v) == null ? "—" : fmtFechaHora.format(valido(v)));
export const fechaLarga = (v) => (valido(v) == null ? "—" : fmtFechaLarga.format(valido(v)));
export const hora = (v) => (valido(v) == null ? "—" : fmtHora.format(valido(v)));

/** "584141234567" → "+58 414 123 4567". Otros formatos se muestran tal cual. */
export function telefono(t) {
  const d = String(t ?? "").replace(/\D/g, "");
  return d.length === 12 && d.startsWith("58") ? `+58 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(t ?? "—");
}

export const enlaceTel = (t) => `tel:+${String(t ?? "").replace(/\D/g, "")}`;
