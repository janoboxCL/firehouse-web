import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esDiaClasePruebaValido,
  diaEstaHabilitado,
  proximaFechaParaDia,
  etiquetaDia,
} from './clase-prueba.ts';

// 2026-08-31 es lunes.
const LUNES = new Date(2026, 7, 31);

test('esDiaClasePruebaValido: sólo acepta VIERNES o SABADO', () => {
  assert.equal(esDiaClasePruebaValido('VIERNES'), true);
  assert.equal(esDiaClasePruebaValido('SABADO'), true);
  assert.equal(esDiaClasePruebaValido('DOMINGO'), false);
  assert.equal(esDiaClasePruebaValido(null), false);
});

test('diaEstaHabilitado: respeta la configuración del mantenedor', () => {
  const habilitados = { viernes: false, sabado: true };
  assert.equal(diaEstaHabilitado('SABADO', habilitados), true);
  assert.equal(diaEstaHabilitado('VIERNES', habilitados), false);
});

test('proximaFechaParaDia: resuelve el próximo sábado desde un lunes', () => {
  const fecha = proximaFechaParaDia('SABADO', LUNES);
  const dow = new Date(`${fecha}T00:00:00`).getDay();
  assert.equal(dow, 6);
  // El lunes 31 de agosto de 2026, el próximo sábado es el 5 de septiembre.
  assert.equal(fecha, '2026-09-05');
});

test('proximaFechaParaDia: resuelve el próximo viernes desde un lunes', () => {
  const fecha = proximaFechaParaDia('VIERNES', LUNES);
  assert.equal(fecha, '2026-09-04');
});

test('proximaFechaParaDia: nunca devuelve el mismo día de "ahora", siempre uno futuro', () => {
  const sabado = new Date(2026, 8, 5); // sábado 5 de septiembre 2026
  const fecha = proximaFechaParaDia('SABADO', sabado);
  assert.notEqual(fecha, '2026-09-05');
  assert.equal(fecha, '2026-09-12');
});

test('etiquetaDia: nombres legibles', () => {
  assert.equal(etiquetaDia('VIERNES'), 'Viernes');
  assert.equal(etiquetaDia('SABADO'), 'Sábado');
});
