import test from 'node:test';
import assert from 'node:assert/strict';
import { esDiaClaseStar, getNextStarClassDate } from './star-class.ts';

test('antes del inicio agenda la primera clase Star', () => {
  assert.equal(getNextStarClassDate(new Date('2026-09-25T12:00:00-03:00')), '2026-10-03');
});

test('el día de la clase conserva la fecha actual', () => {
  assert.equal(getNextStarClassDate(new Date('2026-10-03T12:00:00-03:00')), '2026-10-03');
});

test('después del inicio usa la siguiente fecha del calendario semanal', () => {
  assert.equal(getNextStarClassDate(new Date('2026-10-04T12:00:00-03:00')), '2026-10-10');
  assert.equal(getNextStarClassDate(new Date('2026-10-10T12:00:00-03:00')), '2026-10-10');
});

test('usa la primera clase configurada', () => {
  assert.equal(getNextStarClassDate(new Date('2026-10-20T12:00:00-03:00'), '2026-10-24'), '2026-10-24');
  assert.equal(getNextStarClassDate(new Date('2026-10-25T12:00:00-03:00'), '2026-10-24'), '2026-10-31');
});

test('el día de clase, después de la hora de inicio, pasa al sábado siguiente', () => {
  assert.equal(getNextStarClassDate(new Date('2026-10-03T18:29:00-03:00'), '2026-10-03', '18:30'), '2026-10-03');
  assert.equal(getNextStarClassDate(new Date('2026-10-03T18:30:00-03:00'), '2026-10-03', '18:30'), '2026-10-10');
  assert.equal(getNextStarClassDate(new Date('2026-10-03T23:50:00-03:00'), '2026-10-03', '18:30'), '2026-10-10');
  assert.equal(getNextStarClassDate(new Date('2026-10-10T20:00:00-03:00'), '2026-10-03', '18:30:00'), '2026-10-17');
  // Un día que no es de clase no se ve afectado por la hora.
  assert.equal(getNextStarClassDate(new Date('2026-10-04T21:00:00-03:00'), '2026-10-03', '18:30'), '2026-10-10');
  // Medianoche en Chile (UTC-3): 3 de octubre 02:00 UTC es el 2 de octubre 23:00.
  assert.equal(getNextStarClassDate(new Date('2026-10-04T02:00:00Z'), '2026-10-03', '18:30'), '2026-10-10');
  assert.equal(getNextStarClassDate(new Date('2026-10-03T02:00:00Z'), '2026-10-03', '18:30'), '2026-10-03');
});

test('reconoce los días de clase Star', () => {
  assert.equal(esDiaClaseStar('2026-10-03'), true);
  assert.equal(esDiaClaseStar('2026-10-10'), true);
  assert.equal(esDiaClaseStar('2026-10-09'), false);
  assert.equal(esDiaClaseStar('2026-09-26'), false, 'antes de la primera clase');
  assert.equal(esDiaClaseStar('x'), false);
});
