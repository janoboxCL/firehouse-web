import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capitalizarNombre,
  datosPorCompletar,
  payloadExpress,
  TALLA_NO_SABE,
  telefonoExpress,
  validarExpress,
  type DatosExpress,
} from './registro-express.ts';

const base: DatosExpress = {
  ninos: [{ nombre: 'sofía', edad: 7, talla: '8' }],
  apoderadoNombre: ' carolina ',
  relacion: 'MAMA',
  telefono: '1234 5678',
  consentimiento: true,
};

test('capitaliza nombres y limpia espacios', () => {
  assert.equal(capitalizarNombre('  sofía   ignacia '), 'Sofía Ignacia');
  assert.equal(capitalizarNombre('ÁMBAR'), 'Ámbar');
});

test('WhatsApp: acepta los 8 dígitos tras el 9 o el número completo', () => {
  assert.equal(telefonoExpress('1234 5678'), '+56912345678');
  assert.equal(telefonoExpress('9 1234 5678'), '+56912345678');
  assert.equal(telefonoExpress('+56 9 1234 5678'), '+56912345678');
  assert.equal(telefonoExpress('1234567'), null);
  assert.equal(telefonoExpress('2 2345 6789'), null);
});

test('datos correctos no tienen errores', () => {
  assert.deepEqual(validarExpress(base), {});
});

test('exige nombre, edad, talla (o «No sabe»), apoderado, WhatsApp y autorización', () => {
  const e = validarExpress({
    ninos: [{ nombre: 'S', edad: null, talla: null }],
    apoderadoNombre: '',
    relacion: 'MAMA',
    telefono: '123',
    consentimiento: false,
  });
  assert.deepEqual(Object.keys(e).sort(), ['apoderado', 'consentimiento', 'nino-0-edad', 'nino-0-nombre', 'nino-0-talla', 'telefono']);
  assert.deepEqual(validarExpress({ ...base, ninos: [{ nombre: 'Sofía', edad: 7, talla: TALLA_NO_SABE }] }), {});
  assert.ok(validarExpress({ ...base, ninos: [{ nombre: 'Sofía 2', edad: 7, talla: '8' }] })['nino-0-nombre']);
  assert.ok(validarExpress({ ...base, ninos: [] }).ninos);
});

test('cada hermana se valida por separado', () => {
  const e = validarExpress({ ...base, ninos: [base.ninos[0], { nombre: 'Emma', edad: null, talla: '6' }] });
  assert.deepEqual(Object.keys(e), ['nino-1-edad']);
});

test('payload: nombres capitalizados, teléfono normalizado y «No sabe» sin talla', () => {
  const p = payloadExpress({ ...base, ninos: [base.ninos[0], { nombre: 'emma', edad: 5, talla: TALLA_NO_SABE }] }, '2026-10-03');
  assert.deepEqual(p, {
    fecha: '2026-10-03',
    apoderado: { nombre: 'Carolina', telefono: '+56912345678', relacion: 'MAMA' },
    atletas: [
      { nombre: 'Sofía', edad: 7, talla: '8' },
      { nombre: 'Emma', edad: 5, talla: '' },
    ],
  });
  assert.equal(payloadExpress(base, '2026-10-03', { apoderadoId: 'x' }).apoderadoId, 'x');
  assert.equal(payloadExpress(base, '2026-10-03', { forzarNuevo: true }).forzarNuevo, true);
});

test('datos por completar se deducen de lo que falta', () => {
  assert.deepEqual(datosPorCompletar({ apellidos: '', apoderado: { apellidos: '', email: '', comuna: '' } }), ['apellidos', 'correo', 'comuna']);
  assert.deepEqual(datosPorCompletar({ apellidos: 'Rojas', apoderado: { apellidos: '—', email: 'a@x.cl', comuna: 'La Cisterna' } }), ['apellidos']);
  assert.deepEqual(datosPorCompletar({ apellidos: 'Rojas', apoderado: { apellidos: 'Díaz', email: 'a@x.cl', comuna: 'La Cisterna' } }), []);
});
