// Tests de la Campaña Firehouse 2026.
//
// Las reglas que viven en la base (máximo 3, concurrencia, idempotencia,
// reembolsos, snapshot) se prueban con supabase/tests/campana_2026_test.sql
// sobre una copia de la base. Aquí se verifica la lógica del servidor en
// TypeScript y que la migración mantenga las garantías clave.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dentroDelPeriodo,
  enmascararRut,
  identityHash,
  normalizarRutIdentidad,
} from '../functions/lib/campaign-2026.ts';
import { rutValido } from '../functions/lib/rut.ts';
import { construirHtmlParticipacionGratis } from '../functions/lib/resend.ts';

const migracion = readFileSync(new URL('../supabase/migrations/0005_campana_2026_mecanica_unificada.sql', import.meta.url), 'utf8');
const asignar = (activas, solicitadas) => Math.min(solicitadas, Math.max(0, 3 - activas));

for (const [nombre, activas, solicitadas, esperado] of [
  ['nuevo RUT + Blaze', 0, 1, 1], ['nuevo RUT + Pack', 0, 2, 2], ['con 2 + Pack', 2, 2, 1], ['con 3 + Blaze', 3, 1, 0],
  ['gratis nuevo', 0, 3, 3], ['gratis con 1', 1, 3, 2], ['gratis con 2', 2, 3, 1], ['gratis con 3', 3, 3, 0],
]) test(`regla de asignación: ${nombre}`, () => assert.equal(asignar(activas, solicitadas), esperado));

test('el mismo RUT escrito de distintas formas es la misma persona', async () => {
  const formas = ['12.345.678-5', '12345678-5', '123456785', '012.345.678-5', ' 12345678-5 '];
  assert.ok(formas.every((f) => normalizarRutIdentidad(f) === '123456785'));
  const hashes = await Promise.all(formas.map((f) => identityHash(f, 'secreto')));
  assert.equal(new Set(hashes).size, 1);
  assert.notEqual(await identityHash('12345678-5', 'otro-secreto'), hashes[0]);
});

test('el hash no contiene el RUT y la máscara no lo revela', async () => {
  const hash = await identityHash('12.345.678-5', 'secreto');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes('12345678'));
  assert.equal(enmascararRut('12.345.678-5'), '12.***.***-5');
  assert.equal(enmascararRut('9.876.543-K'), '98.***.***-K');
});

test('RUT con DV inválido se rechaza', () => {
  assert.equal(rutValido('12.345.678-5'), true);
  assert.equal(rutValido('12.345.678-9'), false);
});

test('fuera del periodo de campaña no se aceptan compras ni solicitudes', () => {
  const inicio = '2026-10-01T00:00:00-03:00';
  const cierre = '2026-12-11T23:59:59-03:00';
  assert.equal(dentroDelPeriodo(inicio, cierre, Date.parse('2026-11-01T12:00:00-03:00')), true);
  assert.equal(dentroDelPeriodo(inicio, cierre, Date.parse('2026-12-12T00:00:01-03:00')), false);
  assert.equal(dentroDelPeriodo(null, cierre), false);
});

test('correo gratuito: singular, plural y máximo alcanzado', () => {
  const uno = construirHtmlParticipacionGratis({ nombre: 'Ana Pérez', email: 'a@x.cl', codigos: ['FH26-000007'], total: 3 });
  assert.match(uno, /Se asignó 1 participación promocional/);
  assert.match(uno, /FH26-000007/);
  const dos = construirHtmlParticipacionGratis({ nombre: 'Ana', email: 'a@x.cl', codigos: ['FH26-000008', 'FH26-000009'], total: 3 });
  assert.match(dos, /Se asignaron 2 participaciones/);
  const cero = construirHtmlParticipacionGratis({ nombre: 'Ana', email: 'a@x.cl', codigos: [], total: 3 });
  assert.match(cero, /ya alcanzó el máximo de tres participaciones/);
  const xss = construirHtmlParticipacionGratis({ nombre: '<script>x</script>', email: 'a@x.cl', codigos: [], total: 0 });
  assert.ok(!xss.includes('<script>'));
});

test('la migración es transaccional y protege lo esencial', () => {
  assert.match(migracion, /^begin;$/m);
  assert.match(migracion, /^commit;$/m);
  assert.match(migracion, /from campana_participantes where id = p_participant_id\s+for update/);
  assert.match(migracion, /least\(p_solicitadas, greatest\(0, 3 - v_activas\)\)/);
  assert.match(migracion, /drop function if exists public\.fn_confirmar_pago_campana/);
  assert.match(migracion, /estado = 'READY'/);
  assert.ok(!/'AVAILABLE'/.test(migracion.replace(/^--.*$/gm, '')), 'la entrega debe usar READY, no AVAILABLE');
  assert.match(migracion, /enable row level security/);
  assert.match(migracion, /revoke all on function public\.fn_confirmar_pago_campana/);
  assert.match(migracion, /set search_path = public, extensions/);
  assert.match(migracion, /campana_config_validar_activacion/);
});
