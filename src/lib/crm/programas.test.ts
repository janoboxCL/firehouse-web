import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combinacionHermanos,
  esFechaValida,
  estadoInscripcionPrograma,
  estadoPeriodo,
  hoyChile,
  parsearMonto,
  periodosSolapados,
  programaDesdeJourney,
  segmentoCaso,
  validarPeriodo,
  type PeriodoInscripcion,
} from './programas.ts';

const periodo = (p: Partial<PeriodoInscripcion>): PeriodoInscripcion => ({
  programa_codigo: 'ALL_STAR',
  nombre: 'x',
  abre: '2026-12-01',
  cierra: '2027-01-31',
  clases_inician: null,
  activo: true,
  ...p,
});

test('mapea journeys históricos a programa', () => {
  assert.equal(programaDesdeJourney('RENOVACION_2027'), 'ALL_STAR');
  assert.equal(programaDesdeJourney('EXPERIMENTADA_2027'), 'ALL_STAR');
  assert.equal(programaDesdeJourney('PRINCIPIANTE_2027'), 'ALL_STAR');
  assert.equal(programaDesdeJourney('CLASE_PRUEBA'), null);
  assert.equal(programaDesdeJourney('CLASE_PRUEBA_STAR'), 'STAR');
  assert.equal(programaDesdeJourney('FIREHOUSE_STAR'), 'STAR');
  assert.equal(programaDesdeJourney('PRETEMPORADA'), null);
  assert.equal(programaDesdeJourney('POR_CLASIFICAR'), null);
  assert.equal(programaDesdeJourney(null), null);
});

test('segmenta casos en confirmados, recontactables y archivados', () => {
  assert.equal(segmentoCaso('INSCRITO'), 'CONFIRMADO');
  assert.equal(segmentoCaso('NO_INTERESADO'), 'ARCHIVADO');
  assert.equal(segmentoCaso('NO_CONTINUA'), 'ARCHIVADO');
  assert.equal(segmentoCaso('NUEVO'), 'RECONTACTABLE');
  assert.equal(segmentoCaso('NO_RESPONDE'), 'RECONTACTABLE');
});

test('la combinación de hermanos es canónica sin importar el orden', () => {
  assert.equal(combinacionHermanos('STAR', 'ALL_STAR'), 'ALL_STAR+STAR');
  assert.equal(combinacionHermanos('ALL_STAR', 'STAR'), 'ALL_STAR+STAR');
  assert.equal(combinacionHermanos('STAR', 'STAR'), 'STAR+STAR');
});

test('estado del periodo según la fecha, con bordes inclusivos', () => {
  const p = periodo({});
  assert.equal(estadoPeriodo(p, '2026-11-30'), 'PROXIMO');
  assert.equal(estadoPeriodo(p, '2026-12-01'), 'ABIERTO');
  assert.equal(estadoPeriodo(p, '2027-01-31'), 'ABIERTO');
  assert.equal(estadoPeriodo(p, '2027-02-01'), 'FINALIZADO');
  assert.equal(estadoPeriodo({ ...p, activo: false }, '2026-12-15'), 'INACTIVO');
  assert.equal(estadoPeriodo({ ...p, cierra: null }, '2030-01-01'), 'ABIERTO');
});

test('en septiembre el competitivo está cerrado y el próximo periodo es diciembre', () => {
  const periodos = [
    periodo({ nombre: 'Pretemporada 2027', abre: '2026-12-01', cierra: '2027-01-31' }),
    periodo({ nombre: 'Temporada 2027', abre: '2027-03-01', cierra: '2027-08-31' }),
    periodo({ programa_codigo: 'STAR', nombre: 'Star continuo', abre: '2026-09-01', cierra: null }),
  ];
  const allStar = estadoInscripcionPrograma(periodos, 'ALL_STAR', '2026-09-23');
  assert.equal(allStar.abierta, false);
  assert.equal(allStar.proximo?.nombre, 'Pretemporada 2027');

  const febrero = estadoInscripcionPrograma(periodos, 'ALL_STAR', '2027-02-15');
  assert.equal(febrero.abierta, false);
  assert.equal(febrero.proximo?.nombre, 'Temporada 2027');

  const star = estadoInscripcionPrograma(periodos, 'STAR', '2026-09-23');
  assert.equal(star.abierta, true);
  assert.equal(star.periodoActual?.nombre, 'Star continuo');
});

test('detecta periodos solapados del mismo programa y ignora los de otro programa', () => {
  const a = periodo({ nombre: 'A', abre: '2027-01-01', cierra: '2027-03-31' });
  const b = periodo({ nombre: 'B', abre: '2027-03-01', cierra: null });
  const c = periodo({ programa_codigo: 'STAR', nombre: 'C', abre: '2027-01-01', cierra: null });
  const pares = periodosSolapados([a, b, c]);
  assert.equal(pares.length, 1);
  assert.deepEqual(pares[0].map((p) => p.nombre), ['A', 'B']);
  assert.equal(periodosSolapados([a, { ...b, activo: false }]).length, 0);
});

test('valida periodos', () => {
  const ok = validarPeriodo({ programa_codigo: 'STAR', nombre: '  Star  ', abre: '2026-09-01', cierra: '', clases_inician: '' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.valor.nombre, 'Star');
    assert.equal(ok.valor.cierra, null);
    assert.equal(ok.valor.clases_inician, null);
  }
  assert.equal(validarPeriodo({ programa_codigo: 'OTRO', nombre: 'x', abre: '2026-09-01' }).ok, false);
  assert.equal(validarPeriodo({ programa_codigo: 'STAR', nombre: 'Star', abre: '2026-02-30' }).ok, false);
  assert.equal(validarPeriodo({ programa_codigo: 'STAR', nombre: 'Star', abre: '2026-09-01', cierra: '2026-08-01' }).ok, false);
});

test('valida fechas reales', () => {
  assert.equal(esFechaValida('2027-02-28'), true);
  assert.equal(esFechaValida('2027-02-29'), false);
  assert.equal(esFechaValida('2027-2-1'), false);
});

test('interpreta montos escritos a mano', () => {
  assert.equal(parsearMonto('30000'), 30000);
  assert.equal(parsearMonto('30.000'), 30000);
  assert.equal(parsearMonto('$45.000'), 45000);
  assert.equal(parsearMonto('0'), 0);
  assert.equal(parsearMonto('-5'), null);
  assert.equal(parsearMonto('abc'), null);
  assert.equal(parsearMonto('2000000'), null);
});

test('la fecha de hoy se calcula en hora de Chile', () => {
  // 02:00 UTC del 1 de marzo sigue siendo 28 de febrero en Santiago.
  assert.equal(hoyChile(new Date('2027-03-01T02:00:00Z')), '2027-02-28');
});
