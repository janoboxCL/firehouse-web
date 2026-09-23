import test from 'node:test';
import assert from 'node:assert/strict';
import { BASES_OFICIALES, chequeosCampana, estadoCampana, inicioAdelantado, mensajeErrorActivacion, type ConfigCampana, type EntornoCampana } from './campana-estado.ts';

const completa: ConfigCampana = {
  checkout_habilitado: true, participacion_habilitada: true,
  bases_version: '2026-1.0', privacy_version: '2026-1.0',
  inicio_at: BASES_OFICIALES.inicio, cierre_at: BASES_OFICIALES.cierre, sorteo_at: BASES_OFICIALES.sorteo,
  premios: [...BASES_OFICIALES.premios], proveedor_pago: 'MERCADOPAGO', email_configurado: true, schema_version: 5,
};
const entorno: EntornoCampana = { secretoIdentidad: true, correoServidor: true, pasarelaHabilitada: true, participacionesAnterioresActivas: 0, sorteoCerrado: false };

test('configuración completa: todos los chequeos en verde', () => {
  assert.ok(chequeosCampana(completa, entorno).every((c) => c.ok));
});

test('detecta secreto, participaciones anteriores y fechas incoherentes', () => {
  const r = chequeosCampana({ ...completa, cierre_at: '2026-12-31T00:00:00-03:00' }, { ...entorno, secretoIdentidad: false, participacionesAnterioresActivas: 2 });
  const fallidos = r.filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(fallidos, ['fechas', 'secreto', 'anteriores']);
});

test('estado según habilitación y periodo', () => {
  assert.equal(estadoCampana(completa, entorno, Date.parse('2026-09-23T12:00:00-03:00')), 'FUERA_DE_PERIODO');
  assert.equal(estadoCampana(completa, entorno, Date.parse('2026-10-01T00:00:00-03:00')), 'ABIERTA');
  assert.equal(estadoCampana(completa, entorno, Date.parse('2026-12-12T00:00:00-03:00')), 'FUERA_DE_PERIODO');
  assert.equal(estadoCampana({ ...completa, checkout_habilitado: false, participacion_habilitada: false }, entorno, Date.now()), 'CERRADA');
  assert.equal(estadoCampana(completa, { ...entorno, sorteoCerrado: true }, Date.now()), 'SORTEO_CERRADO');
});

test('inicio adelantado para pruebas', () => {
  assert.equal(inicioAdelantado({ inicio_at: '2026-09-23T10:00:00-03:00' }), true);
  assert.equal(inicioAdelantado({ inicio_at: BASES_OFICIALES.inicio }), false);
});

test('mensajes de error de la base', () => {
  assert.match(mensajeErrorActivacion('configuracion_incompleta: no se puede'), /Falta configuración/);
  assert.match(mensajeErrorActivacion('hay_participaciones_activas_sin_participante: x'), /sin RUT/);
});
