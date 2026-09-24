import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cargosPagables, descripcionMensualidad, generarCommerceOrder, generarToken, mensualidadProrrateada,
  nombreMes, periodoDe, tokenValido, validarSeleccion, vencimientoMensualidad, type CargoSaldo,
} from './cuenta.ts';

test('prorrateo por semana de la primera clase', () => {
  assert.equal(mensualidadProrrateada(30000, '2026-10-03'), 30000);
  assert.equal(mensualidadProrrateada(30000, '2026-10-10'), 22500);
  assert.equal(mensualidadProrrateada(30000, '2026-10-17'), 15000);
  assert.equal(mensualidadProrrateada(30000, '2026-10-24'), 7500);
  assert.equal(mensualidadProrrateada(30000, '2026-10-31'), 7500);
});

test('periodos y textos', () => {
  assert.equal(periodoDe('2026-10-03'), '2026-10-01');
  assert.equal(vencimientoMensualidad('2026-10-01'), '2026-10-05');
  assert.equal(nombreMes('2026-10-01'), 'octubre 2026');
  assert.equal(descripcionMensualidad('Firehouse Star', '2026-10-01', true), 'Mensualidad Firehouse Star · octubre 2026 (proporcional)');
});

const cargo = (p: Partial<CargoSaldo> & { id: string }): CargoSaldo => ({
  atleta_id: 'a', concepto_codigo: 'MENSUALIDAD', periodo: '2026-10-01', descripcion: 'x', monto: 30000, saldo: 30000,
  vencimiento: '2026-10-05', estado: 'PENDIENTE', ...p,
});

test('la inscripción viene marcada; la mensualidad al día es opcional', () => {
  const r = cargosPagables(
    [cargo({ id: 'i', concepto_codigo: 'INSCRIPCION', periodo: null, vencimiento: '2026-10-03', monto: 10000, saldo: 10000 }), cargo({ id: 'm' })],
    '2026-09-28',
  );
  assert.deepEqual(r.map((c) => [c.id, c.sugerido, c.obligatorio]), [['i', true, false], ['m', false, false]]);
});

test('la mensualidad vencida más antigua es obligatoria y no se ofrecen cargos pagados', () => {
  const r = cargosPagables(
    [cargo({ id: 'oct' }), cargo({ id: 'sep', periodo: '2026-09-01', vencimiento: '2026-09-05' }), cargo({ id: 'pag', estado: 'PAGADO', saldo: 0 })],
    '2026-10-10',
  );
  assert.deepEqual(r.map((c) => c.id), ['sep', 'oct']);
  assert.equal(r[0].obligatorio, true);
  assert.equal(r[1].obligatorio, false);
  assert.equal(validarSeleccion(r, ['oct']).ok, false);
  assert.deepEqual(validarSeleccion(r, ['sep', 'oct']), { ok: true, total: 60000 });
  assert.equal(validarSeleccion(r, []).ok, false);
  assert.equal(validarSeleccion(r, ['otro']).ok, false);
});

test('token y número de pago', () => {
  const t = generarToken();
  assert.equal(tokenValido(t), true);
  assert.notEqual(generarToken(), t);
  assert.equal(tokenValido('corto'), false);
  assert.match(generarCommerceOrder(), /^PAGO-[0-9A-Z]+-[0-9A-F]{8}$/);
});
