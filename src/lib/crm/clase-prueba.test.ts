import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tipoSesionPrueba,
  proximasFechasClasePrueba,
  esFechaClasePruebaValida,
  etiquetaFechaClasePrueba,
} from './clase-prueba.ts';

// 2026-08-31 es lunes.
const LUNES = new Date(2026, 7, 31);

test('tipoSesionPrueba: viernes es Cheer, sábado es Gimnasia', () => {
  assert.equal(tipoSesionPrueba('2026-09-04'), 'CHEER'); // viernes
  assert.equal(tipoSesionPrueba('2026-09-05'), 'GIMNASIA'); // sábado
});

test('tipoSesionPrueba: cualquier otro día no es una sesión válida', () => {
  assert.equal(tipoSesionPrueba('2026-09-03'), null); // jueves
});

test('proximasFechasClasePrueba: siempre devuelve sólo viernes y sábados, en orden', () => {
  const fechas = proximasFechasClasePrueba(6, LUNES);
  assert.equal(fechas.length, 6);
  fechas.forEach((f) => assert.notEqual(tipoSesionPrueba(f), null));
  const ordenadas = [...fechas].sort();
  assert.deepEqual(fechas, ordenadas);
});

test('proximasFechasClasePrueba: empieza desde mañana, no desde hoy', () => {
  const viernes = new Date(2026, 8, 4); // viernes 4 de septiembre 2026
  const fechas = proximasFechasClasePrueba(1, viernes);
  assert.notEqual(fechas[0], '2026-09-04'); // no debe incluir el propio viernes de "ahora"
});

test('esFechaClasePruebaValida: acepta un viernes futuro', () => {
  assert.equal(esFechaClasePruebaValida('2026-09-04', LUNES), true);
});

test('esFechaClasePruebaValida: rechaza un día que no es viernes ni sábado', () => {
  assert.equal(esFechaClasePruebaValida('2026-09-03', LUNES), false);
});

test('esFechaClasePruebaValida: rechaza una fecha pasada', () => {
  assert.equal(esFechaClasePruebaValida('2026-08-01', LUNES), false);
});

test('esFechaClasePruebaValida: rechaza formato inválido', () => {
  assert.equal(esFechaClasePruebaValida('no-es-fecha', LUNES), false);
});

test('etiquetaFechaClasePrueba: incluye el tipo de sesión', () => {
  const texto = etiquetaFechaClasePrueba('2026-09-04');
  assert.match(texto, /Cheer/);
  assert.match(texto, /viernes/i);
});
