import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alternar,
  cambiosDeFecha,
  cantidadCambios,
  combinarAlRecargar,
  confirmarGrabado,
  nuevaAsistencia,
  porcentaje,
  textoCambios,
  textoPresentes,
  totalCambios,
} from './asistencia.ts';

test('sin tocar nada no hay cambios', () => {
  const a = nuevaAsistencia(['a1', 'a2']);
  assert.equal(cantidadCambios(a), 0);
  assert.deepEqual(cambiosDeFecha(a), { presentes: [], ausentes: [] });
});

test('marcar agrega un presente y desmarcar lo grabado agrega un ausente', () => {
  const a = nuevaAsistencia(['a1']);
  alternar(a, 'a2', true);
  alternar(a, 'a1', false);
  assert.deepEqual(cambiosDeFecha(a), { presentes: ['a2'], ausentes: ['a1'] });
  assert.equal(cantidadCambios(a), 2);
});

test('marcar y desmarcar lo mismo antes de grabar no deja cambios', () => {
  const a = nuevaAsistencia([]);
  alternar(a, 'a1', true);
  alternar(a, 'a1', false);
  assert.equal(cantidadCambios(a), 0);
});

test('después de grabar, lo marcado queda como grabado', () => {
  const a = nuevaAsistencia(['a1']);
  alternar(a, 'a2', true);
  alternar(a, 'a1', false);
  confirmarGrabado(a);
  assert.equal(cantidadCambios(a), 0);
  assert.deepEqual([...a.guardadas], ['a2']);
});

test('al recargar se conservan las marcas sin grabar', () => {
  const previa = nuevaAsistencia([]);
  alternar(previa, 'a3', true);
  const r = combinarAlRecargar(previa, ['a1']);
  assert.deepEqual([...r.guardadas], ['a1']);
  assert.deepEqual([...r.marcadas], ['a3']);
});

test('al recargar sin cambios pendientes se toma lo grabado en la base', () => {
  const r = combinarAlRecargar(nuevaAsistencia(['a1']), ['a1', 'a2']);
  assert.equal(cantidadCambios(r), 0);
  assert.deepEqual([...r.marcadas].sort(), ['a1', 'a2']);
  assert.equal(cantidadCambios(combinarAlRecargar(undefined, ['a9'])), 0);
});

test('total de cambios suma todas las fechas', () => {
  const f1 = nuevaAsistencia([]);
  alternar(f1, 'a1', true);
  const f2 = nuevaAsistencia(['b1']);
  alternar(f2, 'b1', false);
  alternar(f2, 'b2', true);
  assert.equal(totalCambios(new Map([['2026-10-03', f1], ['2026-10-10', f2]])), 3);
});

test('textos y porcentaje', () => {
  assert.equal(textoCambios(1), '1 cambio');
  assert.equal(textoCambios(3), '3 cambios');
  assert.equal(textoPresentes(12, 40), '12 de 40 presentes');
  assert.equal(porcentaje(12, 40), 30);
  assert.equal(porcentaje(0, 0), 0);
});
