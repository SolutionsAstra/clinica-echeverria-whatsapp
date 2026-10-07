import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CARRILES,
  derivacionesEnEspera,
  diasVisibles,
  lunesDe,
  maquetarSemana,
  partesEnZona,
  resumenPorEspecialidad,
  sumarDias,
} from "./semana.js";

// Caracas = UTC-4 todo el año. 12:00Z = 08:00 en la clínica.
const cita = (id, inicioZ, finZ, extra = {}) => ({
  id,
  doctor_id: 1,
  estado: "confirmada",
  especialidad_codigo: "neurologia",
  especialidad_nombre: "Neurología",
  paciente_nombre: `Paciente ${id}`,
  fecha_hora_inicio: inicioZ,
  fecha_hora_fin: finZ,
  ...extra,
});

test("partesEnZona usa la hora de la clínica, no la del navegador", () => {
  assert.deepEqual(partesEnZona(Date.parse("2026-10-01T02:30:00Z")), { dia: "2026-09-30", minutos: 22 * 60 + 30, diaSemana: 3 });
});

test("lunesDe: cualquier día de la semana lleva al lunes (domingo cierra la semana)", () => {
  assert.equal(lunesDe("2026-10-04"), "2026-09-28"); // domingo
  assert.equal(lunesDe("2026-09-28"), "2026-09-28"); // lunes
  assert.equal(lunesDe("2026-10-01"), "2026-09-28"); // jueves
  assert.equal(sumarDias("2026-09-28", 7), "2026-10-05");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
});

test("diasVisibles: días de atención del doctor + cualquier día con citas", () => {
  const dias = diasVisibles("2026-09-28", [1, 3, 5], new Set(["2026-10-03"]));
  assert.deepEqual(
    dias.map((d) => d.dia),
    ["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-03"],
  );
  // Sin horario cargado: lunes a viernes.
  assert.equal(diasVisibles("2026-09-28", undefined).length, 5);
});

test("maquetarSemana: filtra por doctor y semana, oculta canceladas y calcula la ventana horaria", () => {
  const citas = [
    cita(1, "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"), // mar 08:00–09:00
    cita(2, "2026-09-29T21:30:00Z", "2026-09-29T22:15:00Z", { especialidad_codigo: "estetica" }), // mar 17:30–18:15
    cita(3, "2026-09-30T14:00:00Z", "2026-09-30T15:00:00Z", { estado: "cancelada" }),
    cita(4, "2026-09-30T14:00:00Z", "2026-09-30T15:00:00Z", { doctor_id: 2 }),
    cita(5, "2026-10-06T14:00:00Z", "2026-10-06T15:00:00Z"), // semana siguiente
  ];
  const m = maquetarSemana(citas, {
    doctorId: 1,
    lunes: "2026-09-28",
    horario: { dias: [1, 2, 3, 4, 5], hora_inicio: "08:00", hora_fin: "17:00" },
  });
  assert.equal(m.inicioMin, 8 * 60);
  assert.equal(m.finMin, 19 * 60); // se amplía hasta cubrir la cita de las 18:15
  assert.equal(m.canceladas, 1);
  const martes = m.columnas.find((c) => c.dia === "2026-09-29");
  assert.deepEqual(
    martes.bloques.map((b) => [b.id, b.inicioMin, b.finMin, b.especialidad]),
    [
      [1, 480, 540, "neurologia"],
      [2, 1050, 1095, "estetica"],
    ],
  );
  assert.equal(m.total, 2);
});

test("maquetarSemana: citas solapadas se reparten en carriles", () => {
  const citas = [
    cita(1, "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
    cita(2, "2026-09-29T12:30:00Z", "2026-09-29T13:30:00Z"),
    cita(3, "2026-09-29T13:00:00Z", "2026-09-29T13:30:00Z"),
    cita(4, "2026-09-29T15:00:00Z", "2026-09-29T15:30:00Z"),
  ];
  const { columnas } = maquetarSemana(citas, { doctorId: 1, lunes: "2026-09-28" });
  const b = Object.fromEntries(columnas.find((c) => c.dia === "2026-09-29").bloques.map((x) => [x.id, x]));
  assert.deepEqual([b[1].carril, b[1].carriles], [0, 2]);
  assert.deepEqual([b[2].carril, b[2].carriles], [1, 2]);
  assert.deepEqual([b[3].carril, b[3].carriles], [0, 2]); // reutiliza el carril libre de la cita 1
  assert.deepEqual([b[4].carril, b[4].carriles], [0, 1]); // grupo aparte
});

test("maquetarSemana: especialidades ocultas no se dibujan pero sí se cuentan en el resumen", () => {
  const citas = [
    cita(1, "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
    cita(2, "2026-09-29T14:00:00Z", "2026-09-29T14:30:00Z", { especialidad_codigo: "pediatria" }),
  ];
  const m = maquetarSemana(citas, { doctorId: 1, lunes: "2026-09-28", ocultas: new Set(["pediatria"]) });
  assert.deepEqual(m.columnas.flatMap((c) => c.bloques.map((b) => b.id)), [1]);
  assert.deepEqual(resumenPorEspecialidad(m.citasSemana), [
    { codigo: "neurologia", total: 1 },
    { codigo: "pediatria", total: 1 },
  ]);
});

test("derivacionesEnEspera: solo del doctor, por orden de llegada", () => {
  const lista = [
    { id: "drv_3", doctorId: 1, capturadaEn: "2026-10-04T03:10:00Z" },
    { id: "drv_1", doctorId: 2, capturadaEn: "2026-10-03T23:00:00Z" },
    { id: "drv_2", doctorId: 1, capturadaEn: "2026-10-03T22:05:00Z" },
  ];
  assert.deepEqual(
    derivacionesEnEspera(lista, 1).map((d) => d.id),
    ["drv_2", "drv_3"],
  );
  assert.deepEqual(derivacionesEnEspera(null, 1), []);
});

test("maquetarSemana con doctorId null (vista unificada) incluye a todos los doctores", () => {
  const citas = [
    cita(1, "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
    cita(2, "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z", { doctor_id: 2 }),
  ];
  const m = maquetarSemana(citas, { doctorId: null, lunes: "2026-09-28" });
  const martes = m.columnas.find((c) => c.dia === "2026-09-29");
  assert.equal(martes.bloques.length, 2);
  assert.equal(martes.bloques[0].carriles, 2);
});
/** Invariantes geométricas que CalendarioDoctor necesita para no romperse. */
function verificarGeometria(columnas) {
  for (const col of columnas) {
    for (const b of [...col.bloques, ...col.excedentes]) {
      assert.ok(Number.isInteger(b.carriles) && b.carriles >= 1 && b.carriles <= MAX_CARRILES, `carriles inválidos en ${b.id}`);
      assert.ok(Number.isInteger(b.carril) && b.carril >= 0 && b.carril < b.carriles, `carril fuera de rango en ${b.id}`);
      assert.ok(b.inicioMin >= 0 && b.finMin <= 24 * 60 && b.finMin > b.inicioMin, `franja inválida en ${b.id}`);
    }
  }
}

test("500 citas de Estética solapadas fuera de horario: carriles acotados y '+N' con el resto", () => {
  // 22:00–22:45 en Caracas del martes 29 = 02:00Z del miércoles 30.
  const citas = Array.from({ length: 500 }, (_, i) =>
    cita(i + 1, "2026-09-30T02:00:00Z", "2026-09-30T02:45:00Z", { especialidad_codigo: "estetica" }),
  );
  const m = maquetarSemana(citas, { doctorId: 1, lunes: "2026-09-28" });
  const martes = m.columnas.find((c) => c.dia === "2026-09-29");
  verificarGeometria(m.columnas);
  assert.equal(martes.bloques.length, MAX_CARRILES - 1);
  assert.equal(martes.excedentes.length, 1);
  assert.equal(martes.excedentes[0].cantidad, 500 - (MAX_CARRILES - 1));
  assert.equal(m.finMin, 23 * 60);
});

test("citas consecutivas que se tocan no se apilan, aunque sean muchas", () => {
  // Desde las 18:00 de Caracas (22:00Z), 45 min cada una, una tras otra hasta las 22:30.
  const base = Date.parse("2026-09-29T22:00:00Z");
  const iso = (n) => new Date(base + n * 45 * 60_000).toISOString();
  const citas = Array.from({ length: 6 }, (_, i) => cita(i + 1, iso(i), iso(i + 1), { especialidad_codigo: "estetica" }));
  const m = maquetarSemana(citas, { doctorId: 1, lunes: "2026-09-28" });
  const martes = m.columnas.find((c) => c.dia === "2026-09-29");
  verificarGeometria(m.columnas);
  assert.equal(martes.bloques.length, 6);
  assert.ok(martes.bloques.every((b) => b.carril === 0 && b.carriles === 1));
  assert.equal(martes.excedentes.length, 0);
});

test("una cita que cruza la medianoche se recorta a 24:00 sin altura negativa", () => {
  // 23:30 → 00:15 en Caracas.
  const m = maquetarSemana(
    [cita(1, "2026-09-30T03:30:00Z", "2026-09-30T04:15:00Z", { especialidad_codigo: "estetica" })],
    { doctorId: 1, lunes: "2026-09-28" },
  );
  const b = m.columnas.find((c) => c.dia === "2026-09-29").bloques[0];
  assert.deepEqual([b.inicioMin, b.finMin], [23 * 60 + 30, 24 * 60]);
  assert.equal(m.finMin, 24 * 60);
  verificarGeometria(m.columnas);
});

test("ids repetidos o de texto y fines inválidos no rompen el reparto", () => {
  const citas = [
    cita("a-2", "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
    cita("a-10", "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
    cita("a-10", "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"), // repetida en la respuesta
    cita(7, "2026-09-29T12:00:00Z", null), // sin fin
    cita(8, "2026-09-29T12:00:00Z", "2026-09-29T11:00:00Z"), // fin antes del inicio
  ];
  const m = maquetarSemana(citas, { doctorId: 1, lunes: "2026-09-28" });
  const martes = m.columnas.find((c) => c.dia === "2026-09-29");
  assert.equal(m.duplicadas, 1);
  const dibujadas = martes.bloques.length + martes.excedentes.reduce((n, x) => n + x.cantidad, 0);
  assert.equal(dibujadas, 4);
  assert.equal(new Set(martes.bloques.map((b) => String(b.id))).size, martes.bloques.length); // claves únicas
  verificarGeometria(m.columnas);
});

test("especialidad nula o desconocida no rompe el resumen de la leyenda", () => {
  assert.doesNotThrow(() =>
    resumenPorEspecialidad([{ especialidad: null }, { especialidad: "estetica" }, { especialidad: undefined }]),
  );
});