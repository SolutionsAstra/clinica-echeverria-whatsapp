const { test } = require('node:test');
const assert = require('node:assert/strict');
const { estadoHorario } = require('./horarioLaboral');

// Caracas = UTC-4 todo el año. 2026-10-05 es lunes.
const en = (iso) => estadoHorario(new Date(iso));

test('09:00 y 18:00 en punto están dentro de horario', () => {
  assert.equal(en('2026-10-05T13:00:00Z').dentroDeHorario, true);  // lun 09:00
  assert.equal(en('2026-10-05T22:00:00Z').dentroDeHorario, true);  // lun 18:00
});

test('08:59 → fuera, abre hoy; 18:01 → fuera, abre mañana', () => {
  assert.deepEqual(en('2026-10-05T12:59:00Z'), { dentroDeHorario: false, proximaApertura: 'hoy a partir de las 09:00' });
  assert.deepEqual(en('2026-10-05T22:01:00Z'), { dentroDeHorario: false, proximaApertura: 'mañana a partir de las 09:00' });
});

test('viernes noche y sábado → el lunes', () => {
  assert.equal(en('2026-10-09T23:00:00Z').proximaApertura, 'el lunes a partir de las 09:00');
  assert.equal(en('2026-10-10T15:00:00Z').dentroDeHorario, false); // sáb 11:00
  assert.equal(en('2026-10-10T15:00:00Z').proximaApertura, 'el lunes a partir de las 09:00');
});

test('usa el día de Caracas aunque en UTC ya sea lunes', () => {
  // 02:00 UTC del lunes = domingo 22:00 en Caracas
  assert.deepEqual(en('2026-10-05T02:00:00Z'), { dentroDeHorario: false, proximaApertura: 'mañana a partir de las 09:00' });
});