import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTelefonoCL,
  validarNombre,
  validarEmail,
  validarComuna,
  calcularEdad,
} from './validation.ts';

test('normaliza teléfono: 9 dígitos sin código de país', () => {
  assert.equal(normalizarTelefonoCL('912345678'), '+56912345678');
});

test('normaliza teléfono: con espacios', () => {
  assert.equal(normalizarTelefonoCL('9 1234 5678'), '+56912345678');
});

test('normaliza teléfono: con +56', () => {
  assert.equal(normalizarTelefonoCL('+56912345678'), '+56912345678');
});

test('normaliza teléfono: con +56 y espacios', () => {
  assert.equal(normalizarTelefonoCL('+56 9 1234 5678'), '+56912345678');
});

test('normaliza teléfono: rechaza número sin 9 inicial', () => {
  assert.equal(normalizarTelefonoCL('812345678'), null);
});

test('normaliza teléfono: rechaza longitud incorrecta', () => {
  assert.equal(normalizarTelefonoCL('91234'), null);
});

test('valida nombre: acepta acentos, ñ, apóstrofes y guiones', () => {
  assert.equal(validarNombre('María José D’Angelo-Núñez', 'nombre'), null);
});

test('valida nombre: rechaza muy corto', () => {
  const err = validarNombre('A', 'nombre');
  assert.ok(err);
});

test('valida nombre: rechaza caracteres no permitidos', () => {
  const err = validarNombre('Martina<script>', 'nombre');
  assert.ok(err);
});

test('valida email: normaliza a minúscula', () => {
  const { email, error } = validarEmail('Carolina.Perez@Gmail.com');
  assert.equal(error, null);
  assert.equal(email, 'carolina.perez@gmail.com');
});

test('valida email: rechaza formato inválido', () => {
  const { error } = validarEmail('no-es-un-correo');
  assert.ok(error);
});

test('valida comuna: reconoce comuna existente sin distinguir mayúsculas/acentos', () => {
  const { comuna, error } = validarComuna('la cisterna');
  assert.equal(error, null);
  assert.equal(comuna, 'La Cisterna');
});

test('calcula edad: cumpleaños ya pasado este año', () => {
  const r = calcularEdad('2018-01-01', new Date(Date.UTC(2026, 7, 24)));
  assert.equal(r?.edad, 8);
  assert.equal(r?.fueraRangoHabitual, false);
});

test('calcula edad: cumpleaños todavía no llega este año', () => {
  const r = calcularEdad('2018-12-31', new Date(Date.UTC(2026, 7, 24)));
  assert.equal(r?.edad, 7);
});

test('calcula edad: marca fuera de rango habitual sin bloquear', () => {
  const r = calcularEdad('2024-01-01', new Date(Date.UTC(2026, 7, 24)));
  assert.equal(r?.edad, 2);
  assert.equal(r?.fueraRangoHabitual, true);
});

test('calcula edad: rechaza fecha futura', () => {
  const r = calcularEdad('2027-01-01', new Date(Date.UTC(2026, 7, 24)));
  assert.equal(r, null);
});

test('calcula edad: rechaza fecha inválida', () => {
  const r = calcularEdad('2026-02-30', new Date(Date.UTC(2026, 7, 24)));
  assert.equal(r, null);
});
