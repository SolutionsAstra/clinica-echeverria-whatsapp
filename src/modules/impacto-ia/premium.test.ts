import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPremium, parsearTarifas } from "./domain/premium";

const AHORA = new Date("2026-10-08T15:00:00Z");
const V = { desde: new Date("2026-10-01T15:00:00Z"), hasta: AHORA };
// Recepción 09:00–18:00 Caracas = 13:00–22:00 UTC.
const fuera = (d: Date) => d.getUTCHours() >= 22 || d.getUTCHours() < 13;
const cita = (creado: string, inicio: string, estado: string, origen: string | null, especialidad: string) => ({
  creadoEn: new Date(creado), inicio: new Date(inicio), estado, origen, especialidad,
});

const CITAS = [
  cita("2026-10-02T23:00:00Z", "2026-10-03T14:00:00Z", "no_show", "ia", "pediatria"),        // IA, fuera de horario, inasistente
  cita("2026-10-03T15:00:00Z", "2026-10-04T14:00:00Z", "completada", "ia", "neurologia"),   // IA, en horario
  cita("2026-10-04T02:00:00Z", "2026-10-09T14:00:00Z", "confirmada", "ia", "pediatria"),    // IA, fuera de horario, futura
  cita("2026-09-20T15:00:00Z", "2026-10-05T14:00:00Z", "completada", "panel", "neurologia"), // panel, ocurrida en la ventana
  cita("2026-10-05T01:00:00Z", "2026-10-10T14:00:00Z", "cancelada", "ia", "eeg"),           // cancelada: no cuenta
];
const DERIVACIONES = [
  { capturadaEn: new Date("2026-10-06T01:00:00Z"), reservadaEn: new Date("2026-10-06T14:00:00Z"), estado: "reservada" },
  { capturadaEn: new Date("2026-10-06T02:00:00Z"), reservadaEn: null, estado: "pendiente" },
];

test("calcularPremium: ausentismo por especialidad, conversión e ingresos fuera de horario", () => {
  const { tarifas } = parsearTarifas('{"pediatria":30,"neurologia":60}');
  const m = calcularPremium(V, AHORA, CITAS, DERIVACIONES, fuera, tarifas);

  assert.deepEqual(m.ausentismo, {
    ocurridas: 3,
    inasistentes: 1,
    tasa: 33,
    porEspecialidad: [
      { especialidad: "pediatria", ocurridas: 1, inasistentes: 1, tasa: 100 },
      { especialidad: "neurologia", ocurridas: 2, inasistentes: 0, tasa: 0 },
    ],
  });
  assert.deepEqual(m.conversion, {
    solicitudes: 5, citasIa: 3, reservadasPorRecepcion: 1, sinCita: 1, tasaAutonoma: 60, tasaTotal: 80,
  });
  assert.deepEqual(m.ingresosFueraDeHorario, {
    citas: 2, citasSinTarifa: 0, monto: 60,
    porEspecialidad: [{ especialidad: "pediatria", citas: 2, tarifa: 30, monto: 60 }],
  });
});

test("sin tarifas configuradas el monto es null (no se inventa) y sin solicitudes no hay tasa", () => {
  const m = calcularPremium(V, AHORA, CITAS, [], fuera);
  assert.equal(m.ingresosFueraDeHorario.monto, null);
  assert.equal(m.ingresosFueraDeHorario.citasSinTarifa, 2);
  const vacio = calcularPremium(V, AHORA, [], [], fuera);
  assert.equal(vacio.conversion.tasaAutonoma, null);
  assert.equal(vacio.ausentismo.tasa, null);
});

test("parsearTarifas: ignora claves desconocidas, montos inválidos y JSON roto", () => {
  const ok = parsearTarifas('{"pediatria":30,"cardiologia":90,"eeg":-5}', "usd");
  assert.deepEqual(ok.tarifas, { moneda: "USD", porEspecialidad: { pediatria: 30 } });
  assert.equal(ok.avisos.length, 2);
  assert.equal(parsearTarifas("{roto").avisos.length, 1);
  assert.deepEqual(parsearTarifas(undefined).tarifas.porEspecialidad, {});
});