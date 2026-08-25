import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarJourney } from './journey.ts';
import { CRM_JOURNEYS, INTENCION_INICIAL, INTERES_OPCIONES } from './constants.ts';

test('renovación: firehouse_actual = true → RENOVACION_2027', () => {
  const r = clasificarJourney({ firehouseActual: true, intencionInicial: INTENCION_INICIAL.CONTINUAR });
  assert.equal(r.journey, CRM_JOURNEYS.RENOVACION_2027);
  assert.equal(r.intencionInicial, INTENCION_INICIAL.CONTINUAR);
});

test('renovación indecisa: sigue siendo RENOVACION_2027 con intención INDECISO', () => {
  const r = clasificarJourney({ firehouseActual: true, intencionInicial: INTENCION_INICIAL.INDECISO });
  assert.equal(r.journey, CRM_JOURNEYS.RENOVACION_2027);
  assert.equal(r.intencionInicial, INTENCION_INICIAL.INDECISO);
});

test('renovación sin intención explícita: default a INDECISO, nunca confirmación definitiva', () => {
  const r = clasificarJourney({ firehouseActual: true });
  assert.equal(r.journey, CRM_JOURNEYS.RENOVACION_2027);
  assert.equal(r.intencionInicial, INTENCION_INICIAL.INDECISO);
});

test('pretemporada: nuevo + interés PRETEMPORADA → PRETEMPORADA', () => {
  const r = clasificarJourney({ firehouseActual: false, interes: INTERES_OPCIONES.PRETEMPORADA });
  assert.equal(r.journey, CRM_JOURNEYS.PRETEMPORADA);
});

test('experimentada: nuevo + temporada 2027 + experiencia → EXPERIMENTADA_2027', () => {
  const r = clasificarJourney({
    firehouseActual: false,
    interes: INTERES_OPCIONES.TEMPORADA_2027,
    tieneExperiencia: true,
  });
  assert.equal(r.journey, CRM_JOURNEYS.EXPERIMENTADA_2027);
});

test('principiante: nuevo + temporada 2027 + sin experiencia → PRINCIPIANTE_2027', () => {
  const r = clasificarJourney({
    firehouseActual: false,
    interes: INTERES_OPCIONES.TEMPORADA_2027,
    tieneExperiencia: false,
  });
  assert.equal(r.journey, CRM_JOURNEYS.PRINCIPIANTE_2027);
});

test('por clasificar: nuevo + no sabe → POR_CLASIFICAR', () => {
  const r = clasificarJourney({ firehouseActual: false, interes: INTERES_OPCIONES.NO_SEGURO });
  assert.equal(r.journey, CRM_JOURNEYS.POR_CLASIFICAR);
});

test('por clasificar: interés ausente/no reconocido también cae a POR_CLASIFICAR (nunca queda sin journey)', () => {
  const r = clasificarJourney({ firehouseActual: false });
  assert.equal(r.journey, CRM_JOURNEYS.POR_CLASIFICAR);
});
