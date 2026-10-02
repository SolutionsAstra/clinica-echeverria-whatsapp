#!/usr/bin/env node
// Aplica a BandejaDerivaciones.jsx los cambios que necesita WorkspaceDashboard:
//   1. prop `embebida`: sin fondo ni max-width propios; la tabla flota en vidrio (backdrop-blur-md).
//   2. mensajes para DERIVACION_NO_DISPONIBLE y NOT_FOUND (los devuelve /api/derivaciones/:id/reservar).
//   3. el aviso de éxito no promete una entrega que el backend aún no confirmó (whatsapp: "en_cola").
//
// Uso (desde la raíz del repo):  node scripts/parche-bandeja-embebida.mjs
// Cada reemplazo debe coincidir exactamente una vez; si no, no se escribe nada.
import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "frontend/src/components/dashboard/BandejaDerivaciones.jsx";
let codigo = readFileSync(RUTA, "utf8");

if (codigo.includes("embebida = false")) {
  console.log("El parche ya está aplicado.");
  process.exit(0);
}

const cambios = [
  {
    nombre: "prop embebida",
    antes: `export default function BandejaDerivaciones({
  solicitudes = SOLICITUDES_DEMO,
  onReservar = simularReservaYNotificacion,
}) {`,
    despues: `export default function BandejaDerivaciones({
  solicitudes = SOLICITUDES_DEMO,
  onReservar = simularReservaYNotificacion,
  embebida = false, // dentro de WorkspaceDashboard: sin fondo propio, tabla en vidrio
}) {`,
  },
  {
    nombre: "contenedor exterior",
    antes: `<div className="min-h-screen bg-[#0B192C] font-['Geist',ui-sans-serif,system-ui,sans-serif] text-[#E6E9EE] antialiased">`,
    despues: `<div
      className={
        embebida
          ? "text-[#E6E9EE]"
          : "min-h-screen bg-[#0B192C] font-['Geist',ui-sans-serif,system-ui,sans-serif] text-[#E6E9EE] antialiased"
      }
    >`,
  },
  {
    nombre: "contenedor interior",
    antes: `<div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">`,
    despues: `<div className={embebida ? "px-5 py-8 lg:px-8 lg:py-10" : "mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14"}>`,
  },
  {
    nombre: "tabla en vidrio",
    // backdrop-filter crea un bloque contenedor para hijos position:fixed. El aviso fijo
    // vive FUERA de esta <section>, así que no le afecta; el TimePicker es absolute.
    antes: `<section aria-label="Solicitudes pendientes" className="mt-4 rounded-lg border border-[#1A2D48]">`,
    despues: `<section
          aria-label="Solicitudes pendientes"
          className={\`mt-4 rounded-lg border border-[#1A2D48]\${embebida ? " bg-[#0B192C]/75 backdrop-blur-md" : ""}\`}
        >`,
  },
  {
    nombre: "códigos de error del endpoint de derivaciones",
    antes: `  INVALID_INPUT: "Faltan datos del paciente. Revisa la solicitud antes de reservar.",`,
    despues: `  INVALID_INPUT: "Faltan datos del paciente. Revisa la solicitud antes de reservar.",
  DERIVACION_NO_DISPONIBLE: "Otra persona de recepción ya está gestionando esta derivación. La bandeja se actualizará.",
  NOT_FOUND: "Esta derivación ya no existe. La bandeja se actualizará.",`,
  },
  {
    nombre: "aviso de éxito",
    antes: "${s.paciente} recibió la confirmación por WhatsApp.",
    despues: "La confirmación por WhatsApp a ${s.paciente} está en camino.",
  },
];

const fallos = [];
for (const { nombre, antes, despues } of cambios) {
  const veces = codigo.split(antes).length - 1;
  if (veces !== 1) {
    fallos.push(`${nombre}: se esperaba 1 coincidencia y hay ${veces}`);
    continue;
  }
  codigo = codigo.replace(antes, () => despues);
}

if (fallos.length) {
  console.error(`No se modificó ${RUTA}:\n  - ${fallos.join("\n  - ")}`);
  process.exit(1);
}

writeFileSync(RUTA, codigo);
console.log(`${RUTA}: ${cambios.length} cambios aplicados.`);
