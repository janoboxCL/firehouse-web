import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarModos, filtrarRecepcion, inicial, letrasDisponibles, type PersonaRecepcion } from './recepcion.ts';

const p = (id: string, nombre: string, apellidos: string, apoderado = 'Ana'): PersonaRecepcion => ({ id, nombre, apellidos, apoderado });
const lista = [
  p('1', 'Isidora', 'Rojas Díaz', 'Carolina'),
  p('2', 'Luisina', 'Pérez', 'Daniela'),
  p('3', 'Ámbar', 'Soto', 'Paula'),
  p('4', 'Agustina', 'Isla Vega', 'Camila'),
  p('5', 'Ñandú', 'Prueba'),
];
const nada = { texto: '', letra: null, modo: 'TODOS' as const, presentes: new Set<string>() };

test('inicial sin tildes y letras disponibles ordenadas', () => {
  assert.equal(inicial('Ámbar'), 'A');
  assert.deepEqual(letrasDisponibles(lista), ['A', 'I', 'L', 'N']);
});

test('sin texto ordena por nombre', () => {
  assert.deepEqual(filtrarRecepcion(lista, nada).map((x) => x.id), ['4', '3', '1', '2', '5']);
});

test('texto: primero quien empieza con lo escrito, sin importar tildes', () => {
  // "isi" aparece en Isidora (inicio) y en Luisina (medio)
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, texto: 'isi' }).map((x) => x.id), ['1', '2']);
  // "isla" calza con el apellido de Agustina
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, texto: 'isla' }).map((x) => x.id), ['4']);
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, texto: 'ambar' }).map((x) => x.id), ['3']);
});

test('también busca por el nombre del apoderado', () => {
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, texto: 'carolina' }).map((x) => x.id), ['1']);
});

test('letra filtra por la inicial del nombre', () => {
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, letra: 'A' }).map((x) => x.id), ['4', '3']);
});

test('modos por llegar, llegaron y todos', () => {
  const presentes = new Set(['1', '3']);
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, modo: 'POR_LLEGAR', presentes }).map((x) => x.id), ['4', '2', '5']);
  assert.deepEqual(filtrarRecepcion(lista, { ...nada, modo: 'LLEGARON', presentes }).map((x) => x.id), ['3', '1']);
  assert.deepEqual(contarModos(lista, presentes), { POR_LLEGAR: 3, LLEGARON: 2, TODOS: 5 });
});
