import test from 'node:test';
import assert from 'node:assert/strict';
import { cargoEnMensaje, completarPlantilla, enlaceWhatsApp, fechaClaseTexto, mensajeFaltantes, primerNombre, variablesUsadas } from './plantillas.ts';

const BIENVENIDA = '¡Hola, {nombre_apoderado}! Soy {remitente}, {cargo} de Firehouse Star. Te esperamos {fecha_clase} a las {hora_clase} con {nombre_atleta}.';

test('la firma cambia según quién envía', () => {
  const base = { nombre_apoderado: 'Carolina', nombre_atleta: 'Sofía', fecha_clase: 'el sábado 3 de octubre', hora_clase: '16:00' };
  const benjamin = completarPlantilla(BIENVENIDA, { ...base, remitente: 'Benjamín', cargo: 'Head Coach' });
  assert.equal(benjamin.faltantes.length, 0);
  assert.match(benjamin.texto, /Soy Benjamín, Head Coach de Firehouse Star/);
  const alejandro = completarPlantilla(BIENVENIDA, { ...base, remitente: 'Alejandro', cargo: 'Asistente' });
  assert.match(alejandro.texto, /Soy Alejandro, Asistente de Firehouse Star/);
});

test('informa las variables sin valor y no las deja vacías', () => {
  const r = completarPlantilla('Talla {talla}. Paga en {link_pago}. Hola {nombre_apoderado}', { nombre_apoderado: 'Ana', talla: ' ' });
  assert.deepEqual(r.faltantes, ['talla', 'link_pago']);
  assert.match(r.texto, /\{talla\}/);
  assert.match(mensajeFaltantes(r.faltantes), /talla de polera.*link de pago/);
});

test('ignora llaves que no son variables conocidas', () => {
  assert.deepEqual(variablesUsadas('Hola {nombre_atleta} {desconocida} {nombre_atleta}'), ['nombre_atleta']);
});

test('formatos de apoyo', () => {
  assert.equal(fechaClaseTexto('2026-10-03'), 'el sábado 3 de octubre');
  assert.equal(fechaClaseTexto(null), null);
  assert.equal(primerNombre('  Carolina Andrea Pérez '), 'Carolina');
  assert.equal(enlaceWhatsApp('+56 9 8611 4663', 'Hola & chao'), 'https://wa.me/56986114663?text=Hola%20%26%20chao');
});

test('el cargo va en minúscula dentro de la frase, salvo Head Coach', () => {
  assert.equal(cargoEnMensaje('Asistente'), 'asistente');
  assert.equal(cargoEnMensaje('Coach'), 'coach');
  assert.equal(cargoEnMensaje('Head Coach'), 'Head Coach');
  assert.equal(cargoEnMensaje(null), null);
  assert.equal(cargoEnMensaje(' '), null);
});
