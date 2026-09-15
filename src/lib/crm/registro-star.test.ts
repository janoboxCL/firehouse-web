import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRegistroStar, MONTO_KIT_STAR, MAX_ATLETAS_STAR } from './registro-star.ts';

function apoderadoBase(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Carolina',
    apellidos: 'Pérez',
    telefono: '9 1234 5678',
    email: 'carolina@example.com',
    comuna: 'La Cisterna',
    ...overrides,
  };
}

function atletaBase(overrides: Record<string, unknown> = {}) {
  return { nombre: 'Martina', apellidos: '', fechaNacimiento: '2019-03-10', ...overrides };
}

function envio(atletas: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return { apoderado: apoderadoBase(), atletas, aceptaCondiciones: true, ...overrides };
}

test('registro válido con un solo atleta → ok, monto = 1x el kit', () => {
  const r = validarRegistroStar(envio([atletaBase()]));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.datos.atletas.length, 1);
    assert.equal(r.datos.montoTotal, MONTO_KIT_STAR);
    assert.equal(r.datos.apoderado.email, 'carolina@example.com');
  }
});

test('registro con varios atletas → monto se multiplica por la cantidad', () => {
  const r = validarRegistroStar(
    envio([atletaBase({ nombre: 'Martina' }), atletaBase({ nombre: 'Pedro' }), atletaBase({ nombre: 'Sofía' })]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.datos.atletas.length, 3);
    assert.equal(r.datos.montoTotal, MONTO_KIT_STAR * 3);
  }
});

test('atleta sin apellidos → hereda los apellidos del apoderado', () => {
  const r = validarRegistroStar(envio([atletaBase({ apellidos: '' })]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.datos.atletas[0].apellidos, 'Pérez');
});

test('sin atletas → cantidad_atletas_invalida', () => {
  const r = validarRegistroStar(envio([]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'cantidad_atletas_invalida');
});

test(`más de ${MAX_ATLETAS_STAR} atletas → cantidad_atletas_invalida`, () => {
  const atletas = Array.from({ length: MAX_ATLETAS_STAR + 1 }, (_, i) => atletaBase({ nombre: `Niño${i}` }));
  const r = validarRegistroStar(envio(atletas));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'cantidad_atletas_invalida');
});

test('nombre de apoderado muy corto → nombre_apoderado_invalido', () => {
  const r = validarRegistroStar(envio([atletaBase()], { apoderado: apoderadoBase({ nombre: 'A' }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'nombre_apoderado_invalido');
});

test('correo inválido → email_invalido', () => {
  const r = validarRegistroStar(envio([atletaBase()], { apoderado: apoderadoBase({ email: 'no-es-un-correo' }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'email_invalido');
});

test('teléfono con menos de 8 dígitos → telefono_invalido', () => {
  const r = validarRegistroStar(envio([atletaBase()], { apoderado: apoderadoBase({ telefono: '123' }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'telefono_invalido');
});

test('sin comuna → comuna_invalida', () => {
  const r = validarRegistroStar(envio([atletaBase()], { apoderado: apoderadoBase({ comuna: '' }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'comuna_invalida');
});

test('atleta sin nombre → nombre_atleta_invalido', () => {
  const r = validarRegistroStar(envio([atletaBase({ nombre: '' })]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'nombre_atleta_invalido');
});

test('fecha de nacimiento inválida (no parseable) → fecha_nacimiento_invalida', () => {
  const r = validarRegistroStar(envio([atletaBase({ fechaNacimiento: 'no-es-una-fecha' })]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'fecha_nacimiento_invalida');
});

test('fecha de nacimiento futura → fecha_nacimiento_futura', () => {
  const enUnAnio = new Date();
  enUnAnio.setFullYear(enUnAnio.getFullYear() + 1);
  const r = validarRegistroStar(envio([atletaBase({ fechaNacimiento: enUnAnio.toISOString().slice(0, 10) })]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'fecha_nacimiento_futura');
});

test('sin aceptar condiciones → debe_aceptar_condiciones', () => {
  const r = validarRegistroStar(envio([atletaBase()], { aceptaCondiciones: false }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'debe_aceptar_condiciones');
});

test('un segundo atleta inválido invalida todo el registro (no se procesan parcialmente)', () => {
  const r = validarRegistroStar(envio([atletaBase(), atletaBase({ nombre: '' })]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'nombre_atleta_invalido');
});

test('recorta campos de más de 80/120/254 caracteres en vez de fallar', () => {
  const nombreLargo = 'A'.repeat(200);
  const r = validarRegistroStar(envio([atletaBase()], { apoderado: apoderadoBase({ nombre: nombreLargo }) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.datos.apoderado.nombre.length, 80);
});
