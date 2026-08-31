import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRegistroPublico } from './registro.ts';
import { CRM_JOURNEYS, INTENCION_INICIAL } from './constants.ts';

function baseApoderado(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Carolina',
    apellidos: 'Pérez',
    telefono: '9 1234 5678',
    telefonoSecundario: '',
    email: 'carolina@example.com',
    relacion: 'MAMA',
    comuna: 'La Cisterna',
    comoConocio: 'INSTAGRAM',
    canalPreferido: 'WHATSAPP',
    comentarioInicial: '',
    consentContact: true,
    ...overrides,
  };
}

function envio(atletas: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    submissionId: '11111111-1111-1111-1111-111111111111',
    honeypot: '',
    apoderado: baseApoderado(),
    atletas,
    ...overrides,
  };
}

test('Caso 1 — Martina: sin experiencia, interés Pretemporada → PRETEMPORADA', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Martina',
        apellidos: 'Pérez',
        fechaNacimiento: '2018-01-10',
        firehouseActual: false,
        interes: 'PRETEMPORADA',
        tieneExperiencia: false,
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas.length, 1);
    assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.PRETEMPORADA);
  }
});

test('Caso 2 — Sofía: 3 años de experiencia, interés Temporada 2027 → EXPERIMENTADA_2027', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Sofía',
        apellidos: 'Rojas',
        fechaNacimiento: '2013-05-01',
        firehouseActual: false,
        interes: 'TEMPORADA_2027',
        tieneExperiencia: true,
        aniosExperiencia: 'Y3_4',
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.EXPERIMENTADA_2027);
});

test('Caso 3 — Antonia: ya entrena en Firehouse, quiere continuar → RENOVACION_2027 / CONTINUAR', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Antonia',
        apellidos: 'Silva',
        fechaNacimiento: '2017-03-01',
        firehouseActual: true,
        intencionInicial: 'CONTINUAR',
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.RENOVACION_2027);
    assert.equal(r.value.atletas[0].intencionInicial, INTENCION_INICIAL.CONTINUAR);
  }
});

test('Caso 4 — Paula registra dos atletas: 1 apoderado, 2 atletas, journeys independientes', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Martina',
        apellidos: 'Soto',
        fechaNacimiento: '2017-06-01',
        firehouseActual: false,
        interes: 'PRETEMPORADA',
        tieneExperiencia: false,
      },
      {
        nombre: 'Vicente',
        apellidos: 'Soto',
        fechaNacimiento: '2015-06-01',
        firehouseActual: false,
        interes: 'TEMPORADA_2027',
        tieneExperiencia: false,
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas.length, 2);
    assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.PRETEMPORADA);
    assert.equal(r.value.atletas[1].journey, CRM_JOURNEYS.PRINCIPIANTE_2027);
  }
});

test('rechaza sin consentimiento', () => {
  const r = validarRegistroPublico(
    envio(
      [{ nombre: 'Martina', apellidos: 'Soto', fechaNacimiento: '2017-06-01', firehouseActual: false, interes: 'PRETEMPORADA', tieneExperiencia: false }],
      { apoderado: baseApoderado({ consentContact: false }) },
    ),
  );
  assert.equal(r.ok, false);
});

test('rechaza honeypot relleno (bot)', () => {
  const r = validarRegistroPublico(
    envio(
      [{ nombre: 'Martina', apellidos: 'Soto', fechaNacimiento: '2017-06-01', firehouseActual: false, interes: 'PRETEMPORADA', tieneExperiencia: false }],
      { honeypot: 'soy-un-bot' },
    ),
  );
  assert.equal(r.ok, false);
});

test('rechaza sin atletas', () => {
  const r = validarRegistroPublico(envio([]));
  assert.equal(r.ok, false);
});

test('rechaza teléfono inválido', () => {
  const r = validarRegistroPublico(
    envio(
      [{ nombre: 'Martina', apellidos: 'Soto', fechaNacimiento: '2017-06-01', firehouseActual: false, interes: 'PRETEMPORADA', tieneExperiencia: false }],
      { apoderado: baseApoderado({ telefono: '12345' }) },
    ),
  );
  assert.equal(r.ok, false);
});

test('marca fuera_rango_habitual sin bloquear el registro', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Bebé',
        apellidos: 'Test',
        fechaNacimiento: '2025-01-01',
        firehouseActual: false,
        interes: 'NO_SEGURO',
        tieneExperiencia: false,
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas[0].fueraRangoHabitual, true);
    assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.POR_CLASIFICAR);
  }
});

test('clase de prueba: se puede combinar con cualquier interés, no lo reemplaza', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Martina',
        apellidos: 'Soto',
        fechaNacimiento: '2017-06-01',
        firehouseActual: false,
        interes: 'TEMPORADA_2027',
        tieneExperiencia: false,
        quiereClasePrueba: true,
        fechaClasePrueba: '2026-09-04', // viernes
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas[0].journey, CRM_JOURNEYS.PRINCIPIANTE_2027); // el interés sigue mandando el journey
    assert.equal(r.value.atletas[0].quiereClasePrueba, true);
    assert.equal(r.value.atletas[0].fechaClasePrueba, '2026-09-04');
  }
});

test('clase de prueba: rechaza si piden pero la fecha no es viernes/sábado', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Martina',
        apellidos: 'Soto',
        fechaNacimiento: '2017-06-01',
        firehouseActual: false,
        interes: 'PRETEMPORADA',
        tieneExperiencia: false,
        quiereClasePrueba: true,
        fechaClasePrueba: '2026-09-03', // jueves
      },
    ]),
  );
  assert.equal(r.ok, false);
});

test('clase de prueba: no se pide (ni tiene sentido) si ya entrena en Firehouse', () => {
  const r = validarRegistroPublico(
    envio([
      {
        nombre: 'Antonia',
        apellidos: 'Silva',
        fechaNacimiento: '2017-03-01',
        firehouseActual: true,
        intencionInicial: 'CONTINUAR',
        quiereClasePrueba: true,
        fechaClasePrueba: '2026-09-04',
      },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.atletas[0].quiereClasePrueba, false);
    assert.equal(r.value.atletas[0].fechaClasePrueba, null);
  }
});
