import test from 'node:test';
import assert from 'node:assert/strict';
import type { CasoResumen, ItemPrimeraClase } from './admin-api.ts';
import { csvAsistencia, cumpleBusqueda, cumpleFiltro, filasAsistencia, htmlAsistencia, ordenarItems } from './clase-prueba-lista.ts';

function item(id: string, o: { nombre: string; apoderado: string; estado?: string; tipo?: 'PRUEBA' | 'INSCRIPCION'; email?: string; creado?: string; nac?: string; journey?: string; nota?: string }): ItemPrimeraClase {
  const caso = {
    id,
    journey: o.journey ?? (o.tipo === 'PRUEBA' ? 'CLASE_PRUEBA_STAR' : 'FIREHOUSE_STAR'),
    estado: o.estado ?? 'NUEVO',
    comentario_inicial: o.nota ?? null,
    created_at: o.creado ?? '2026-09-20T12:00:00Z',
    atleta: {
      id: `a-${id}`,
      nombre: o.nombre,
      apellidos: 'Pérez',
      fecha_nacimiento: o.nac ?? '2018-10-10',
      apoderado: { id: `ap-${id}`, nombre: o.apoderado, apellidos: 'Soto', telefono: '+56 9 1111 2222', email: o.email ?? `${id}@x.cl`, relacion: 'MAMA' },
    },
  } as unknown as CasoResumen;
  return { caso, tipo: o.tipo ?? 'INSCRIPCION', fecha: '2026-10-03' };
}

const sofia = item('1', { nombre: 'Sofía', apoderado: 'Carla', estado: 'INSCRITO', creado: '2026-09-22T12:00:00Z' });
const emilia = item('2', { nombre: 'Emilia', apoderado: 'Álvaro', creado: '2026-09-21T12:00:00Z' });
const isidora = item('3', { nombre: 'Isidora', apoderado: 'Beatriz', tipo: 'PRUEBA', email: '', creado: '2026-09-25T12:00:00Z' });
const todas = [sofia, emilia, isidora];

test('filtra por estado de pago, tipo, talla y correo', () => {
  const tallas = new Map([['a-1', 'M']]);
  const ids = (f: Parameters<typeof cumpleFiltro>[1]) => todas.filter((i) => cumpleFiltro(i, f, tallas.get(i.caso.atleta.id))).map((i) => i.caso.id);
  assert.deepEqual(ids('KIT_PAGADO'), ['1']);
  assert.deepEqual(ids('KIT_PENDIENTE'), ['2']);
  assert.deepEqual(ids('PRUEBA'), ['3']);
  assert.deepEqual(ids('SIN_TALLA'), ['2', '3']);
  assert.deepEqual(ids('SIN_CORREO'), ['3']);
  assert.equal(ids('TODOS').length, 3);
});

test('busca por alumna, apoderado o teléfono sin importar tildes', () => {
  assert.equal(cumpleBusqueda(sofia, 'sofia'), true);
  assert.equal(cumpleBusqueda(emilia, 'alvaro'), true);
  assert.equal(cumpleBusqueda(emilia, '1111'), true);
  assert.equal(cumpleBusqueda(emilia, 'carla'), false);
  assert.equal(cumpleBusqueda(emilia, ''), true);
});

test('ordena por alumna, apoderado, estado de pago o registro', () => {
  const orden = (o: Parameters<typeof ordenarItems>[1]) => ordenarItems(todas, o).map((i) => i.caso.atleta.nombre);
  assert.deepEqual(orden('ALUMNA'), ['Emilia', 'Isidora', 'Sofía']);
  assert.deepEqual(orden('APODERADO'), ['Emilia', 'Isidora', 'Sofía']); // Álvaro, Beatriz, Carla
  assert.deepEqual(orden('ESTADO'), ['Emilia', 'Isidora', 'Sofía']); // pendiente, prueba, pagada
  assert.deepEqual(orden('REGISTRO'), ['Emilia', 'Sofía', 'Isidora']);
});

test('arma la lista de asistencia con edad al día de la clase', () => {
  const filas = filasAsistencia(todas, new Map([['a-1', 'M']]), '2026-10-03');
  assert.deepEqual(filas.map((f) => f.alumna), ['Emilia Pérez', 'Isidora Pérez', 'Sofía Pérez']);
  assert.equal(filas[0].edad, 7, 'cumple 8 el 10 de octubre: el 3 tiene 7');
  assert.equal(filas[2].talla, 'M');
  assert.equal(filas[2].pago, 'Kit pagado');
  assert.equal(filas[0].pago, 'Kit pendiente');
  assert.equal(filas[1].tipo, 'Prueba Star');
  assert.equal(filas[0].relacion, 'Mamá');
});

test('el Excel usa ; con BOM, escapa comillas y evita fórmulas', () => {
  const filas = filasAsistencia([item('9', { nombre: 'Ana', apoderado: 'Luz', nota: '=suma; "ojo"' })], new Map(), '2026-10-03');
  const csv = csvAsistencia(filas);
  assert.ok(csv.startsWith('﻿N°;Alumna;Edad'));
  assert.match(csv, /"'=suma; ""ojo"""/);
  assert.equal(csv.trim().split('\r\n').length, 2);
});

test('la página imprimible escapa los datos', () => {
  const html = htmlAsistencia('Asistencia', 'Sábado 3', filasAsistencia([item('9', { nombre: '<b>Ana</b>', apoderado: 'Luz' })], new Map(), '2026-10-03'));
  assert.doesNotMatch(html, /<b>Ana/);
  assert.match(html, /&lt;b&gt;Ana/);
  assert.match(html, /1 alumna/);
});
