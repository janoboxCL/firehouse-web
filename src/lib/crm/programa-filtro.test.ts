import test from 'node:test';
import assert from 'node:assert/strict';
import { coincidePrograma, contarPorPrograma } from './programa-filtro.ts';

test('filtra por programa, incluyendo los casos sin programa', () => {
  assert.equal(coincidePrograma('STAR', 'TODOS'), true);
  assert.equal(coincidePrograma('STAR', 'STAR'), true);
  assert.equal(coincidePrograma('STAR', 'ALL_STAR'), false);
  assert.equal(coincidePrograma(null, 'SIN_PROGRAMA'), true);
  assert.equal(coincidePrograma('ALL_STAR', 'SIN_PROGRAMA'), false);
});

test('cuenta casos por programa', () => {
  assert.deepEqual(contarPorPrograma([{ programa: 'STAR' }, { programa: 'STAR' }, { programa: 'ALL_STAR' }, { programa: null }, {}]), {
    TODOS: 5, ALL_STAR: 1, STAR: 2, SIN_PROGRAMA: 2,
  });
});
