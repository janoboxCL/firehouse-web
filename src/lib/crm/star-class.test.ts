import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextStarClassDate } from './star-class.ts';

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
