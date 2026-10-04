#!/usr/bin/env node
// Ajustes puntuales a archivos existentes que acompañan al panel unificado de Astra (2026-10-04):
//   1. BandejaDerivaciones.jsx y AgendaAlertsPanel.jsx toman ESPECIALIDADES de workspace/especialidades.js
//      (un archivo de componente que exporta un objeto dispara react-refresh/only-export-components).
//   2. db.ts → citasParaRecordatorios deja de mirar el recordatorio de 24 h (retirado).
//   3. Se elimina WorkspaceDashboard.jsx: AdminDashboard + vistas/DerivacionesView lo reemplazan.
//
// Uso (desde la raíz del repo):  node scripts/parche-astra-plan.mjs [--dry-run]
// Cada reemplazo debe coincidir exactamente una vez; si alguno falla, no se escribe NADA.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const SECO = process.argv.includes("--dry-run");
const RAIZ = process.env.RAIZ_REPO ?? ".";

const ARCHIVOS = [
  {
    ruta: "frontend/src/components/dashboard/BandejaDerivaciones.jsx",
    yaAplicado: 'from "./workspace/especialidades"',
    cambios: [
      {
        nombre: "importar ESPECIALIDADES",
        antes: `  Sunset,\n} from "lucide-react";\n`,
        despues: `  Sunset,\n} from "lucide-react";\nimport { ESPECIALIDADES } from "./workspace/especialidades";\n`,
      },
      {
        nombre: "quitar la definición local",
        antes: ` * Los colores son compartidos con el calendario unificado: impórtalos desde aquí.
 * ──────────────────────────────────────────────────────────────────────────── */
export const ESPECIALIDADES = {
  neurologia: { nombre: "Neurología", color: "#8B9CF7", duracionMin: 60 },
  eeg: { nombre: "EEG", color: "#5EC4C0", duracionMin: 120 },
  pediatria: { nombre: "Pediatría", color: "#E8B96A", duracionMin: 30 },
  estetica: { nombre: "Estética", color: "#E59AB4", duracionMin: 45 },
};
`,
        despues: ` * Especialidades (colores y duraciones): workspace/especialidades.js, compartido con el calendario.
 * ──────────────────────────────────────────────────────────────────────────── */
`,
      },
    ],
  },
  {
    ruta: "frontend/src/components/dashboard/workspace/AgendaAlertsPanel.jsx",
    yaAplicado: 'from "./especialidades"',
    cambios: [
      {
        nombre: "importar ESPECIALIDADES",
        antes: `import { ESPECIALIDADES } from "../BandejaDerivaciones";`,
        despues: `import { ESPECIALIDADES } from "./especialidades";`,
      },
    ],
  },
  {
    ruta: "src/db.ts",
    yaAplicado: "AND NOT c.recordatorio_2h_enviado\n",
    cambios: [
      {
        nombre: "recordatorios: solo 2 h",
        antes: `      AND (NOT c.recordatorio_24h_enviado OR NOT c.recordatorio_2h_enviado)\n`,
        despues: `      AND NOT c.recordatorio_2h_enviado\n`,
      },
    ],
  },
];

const BORRAR = ["frontend/src/components/dashboard/WorkspaceDashboard.jsx"];

const errores = [];
const escrituras = [];

for (const { ruta, yaAplicado, cambios } of ARCHIVOS) {
  const completa = `${RAIZ}/${ruta}`;
  if (!existsSync(completa)) {
    errores.push(`${ruta}: no existe`);
    continue;
  }
  let codigo = readFileSync(completa, "utf8").replace(/\r\n/g, "\n");
  if (codigo.includes(yaAplicado)) {
    console.log(`= ${ruta}: ya estaba aplicado`);
    continue;
  }
  for (const { nombre, antes, despues } of cambios) {
    const veces = codigo.split(antes).length - 1;
    if (veces !== 1) {
      errores.push(`${ruta} → "${nombre}": se esperaba 1 coincidencia, hay ${veces}`);
      continue;
    }
    codigo = codigo.replace(antes, () => despues);
  }
  escrituras.push([completa, codigo, ruta]);
}

if (errores.length) {
  console.error("No se aplicó nada:\n  " + errores.join("\n  "));
  process.exit(1);
}

for (const [completa, codigo, ruta] of escrituras) {
  if (!SECO) writeFileSync(completa, codigo);
  console.log(`${SECO ? "~" : "✓"} ${ruta}`);
}
for (const ruta of BORRAR) {
  const completa = `${RAIZ}/${ruta}`;
  if (!existsSync(completa)) continue;
  if (!SECO) rmSync(completa);
  console.log(`${SECO ? "~" : "✓"} eliminado ${ruta}`);
}
if (SECO) console.log("(--dry-run: no se escribió nada)");
