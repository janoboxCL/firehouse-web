import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_RESPALDO, configDesdeFila, filaDesdeConfig, horarioDesdeFila, montosProrrateo, parsearTallas,
  textoHorario, validarConfig, validarHorario,
} from './config-academia.ts';

test('lee la fila de la base y usa respaldo si falta', () => {
  const c = configDesdeFila({
    star_primera_clase: '2026-10-03', star_hora_inicio: '16:00:00', star_hora_fin: '17:30:00',
    cobro_dia_vencimiento: 10, cobro_prorrateo: [100, 80, 60, 40], tallas_polera: ['S', 'M'],
  });
  assert.equal(c.starHoraInicio, '16:00');
  assert.equal(c.starHoraFin, '17:30');
  assert.equal(c.diaVencimiento, 10);
  assert.deepEqual(c.prorrateo, [100, 80, 60, 40]);
  assert.deepEqual(configDesdeFila(null), CONFIG_RESPALDO);
  assert.equal(filaDesdeConfig(c).star_hora_inicio, '16:00');
});

test('valida la configuración', () => {
  assert.equal(validarConfig(CONFIG_RESPALDO).ok, true);
  assert.equal(validarConfig({ ...CONFIG_RESPALDO, starHoraFin: '18:00' }).ok, false);
  assert.equal(validarConfig({ ...CONFIG_RESPALDO, diaVencimiento: 31 }).ok, false);
  assert.equal(validarConfig({ ...CONFIG_RESPALDO, prorrateo: [100, 75, 50] }).ok, false);
  assert.equal(validarConfig({ ...CONFIG_RESPALDO, prorrateo: [100, 75, 50, 120] }).ok, false);
  assert.equal(validarConfig({ ...CONFIG_RESPALDO, tallas: [] }).ok, false);
});

test('horarios de clase de prueba', () => {
  const h = horarioDesdeFila({ dia: 'SABADO', habilitado: true, disciplina: 'Gimnasia', hora_inicio: '16:00:00', hora_fin: '18:00:00' });
  assert.equal(textoHorario(h), 'Gimnasia, 16:00–18:00');
  assert.equal(validarHorario(h).ok, true);
  assert.equal(validarHorario({ ...h, horaFin: '15:00' }).ok, false);
  assert.equal(validarHorario({ ...h, horaInicio: null }).ok, false);
  assert.equal(validarHorario({ ...h, habilitado: false, horaInicio: null, horaFin: null }).ok, true);
});

test('tallas y montos', () => {
  assert.deepEqual(parsearTallas(' 4, 6, s, M, m ,, xl '), ['4', '6', 'S', 'M', 'XL']);
  assert.deepEqual(montosProrrateo(30000, [100, 75, 50, 25]), [30000, 22500, 15000, 7500]);
});
