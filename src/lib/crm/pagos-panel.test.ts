import test from 'node:test';
import assert from 'node:assert/strict';
import { armarFamilias, mesChile, normalizarBusqueda, textoBusqueda, totalesPagos, validarCargoManual, type EntradaFamilias } from './pagos-panel.ts';

const A1 = '00000000-0000-0000-0000-00000000a001';
const A2 = '00000000-0000-0000-0000-00000000a002';
const A3 = '00000000-0000-0000-0000-00000000a003';

function entrada(): EntradaFamilias {
  return {
    apoderados: [
      { id: A1, nombre: 'Carla', apellidos: 'Muñoz', telefono: '+569', email: 'c@x.cl' },
      { id: A2, nombre: 'Daniela', apellidos: 'Rojas', telefono: '+569', email: 'd@x.cl' },
      { id: A3, nombre: 'Alejandro', apellidos: 'Prueba', telefono: '+569', email: 'a@x.cl', es_prueba: true },
    ],
    atletas: [
      { id: 'b1', apoderado_id: A1, nombre: 'Sofía Andrea', apellidos: 'M' },
      { id: 'b2', apoderado_id: A2, nombre: 'Emilia', apellidos: 'R' },
      { id: 'b3', apoderado_id: A3, nombre: 'Test', apellidos: 'P' },
    ],
    estadoCaso: { b1: 'INSCRITO', b2: 'NUEVO' },
    cargos: [
      { id: 'c1', apoderado_id: A1, atleta_id: 'b1', concepto_codigo: 'MENSUALIDAD', descripcion: 'Mensualidad octubre', monto: 22500, saldo: 22500, vencimiento: '2026-10-05', estado: 'PENDIENTE' },
      { id: 'c2', apoderado_id: A1, atleta_id: 'b1', concepto_codigo: 'INSCRIPCION', descripcion: 'Inscripción', monto: 10000, saldo: 0, vencimiento: '2026-10-03', estado: 'PAGADO' },
      { id: 'c3', apoderado_id: A1, atleta_id: 'b1', concepto_codigo: 'UNIFORME', descripcion: 'Anulado', monto: 5000, saldo: 5000, vencimiento: null, estado: 'ANULADO' },
      { id: 'c4', apoderado_id: A3, atleta_id: 'b3', concepto_codigo: 'CARGO_MANUAL', descripcion: 'Prueba', monto: 1000, saldo: 0, vencimiento: null, estado: 'PAGADO' },
    ],
    kits: [{ orden_id: 'o2', commerce_order: 'STAR-2', atleta_id: 'b2', monto: 10000, fecha: '2026-09-20', registrado: false }],
    links: { [A1]: 'https://firehousecheer.cl/pagar?t=x' },
    ultimoPago: {},
    hoy: '2026-10-10',
  };
}

test('arma una fila por familia con saldo, vencido y estado', () => {
  const f = armarFamilias(entrada());
  const carla = f.find((x) => x.apoderado.id === A1)!;
  assert.equal(carla.estado, 'VENCIDO');
  assert.equal(carla.saldo, 22500);
  assert.equal(carla.vencido, 22500);
  assert.equal(carla.pagado, 10000);
  assert.equal(carla.totalCargos, 2, 'el cargo anulado no cuenta');
  assert.equal(carla.abiertos[0].atleta_nombre, 'Sofía');
  assert.equal(carla.link, 'https://firehousecheer.cl/pagar?t=x');
  // Orden: vencidos primero, luego sin cargos, al día al final.
  assert.deepEqual(f.map((x) => x.estado), ['VENCIDO', 'SIN_CARGOS', 'AL_DIA']);
});

test('marca el kit pagado en el registro Star que falta pasar a la cuenta', () => {
  const daniela = armarFamilias(entrada()).find((x) => x.apoderado.id === A2)!;
  assert.equal(daniela.estado, 'SIN_CARGOS');
  assert.equal(daniela.atletas[0].kit, 'PENDIENTE');
  assert.equal(daniela.kitsSinRegistrar.length, 1);
  const e = entrada();
  e.kits[0].registrado = true;
  const d2 = armarFamilias(e).find((x) => x.apoderado.id === A2)!;
  assert.equal(d2.atletas[0].kit, 'REGISTRADO');
  assert.equal(d2.kitsSinRegistrar.length, 0);
});

test('antes del vencimiento queda por pagar, no vencido', () => {
  const e = entrada();
  e.hoy = '2026-10-05';
  const carla = armarFamilias(e).find((x) => x.apoderado.id === A1)!;
  assert.equal(carla.estado, 'PENDIENTE');
  assert.equal(carla.vencido, 0);
});

test('los totales excluyen a las familias de prueba', () => {
  const e = entrada();
  const familias = armarFamilias(e);
  const t = totalesPagos(
    familias,
    [
      { cargo_id: 'c2', monto: 10000, estado_pago: 'APROBADO', aprobado_at: '2026-10-02T15:00:00Z' },
      { cargo_id: 'c4', monto: 1000, estado_pago: 'APROBADO', aprobado_at: '2026-10-02T15:00:00Z' },
      { cargo_id: 'c1', monto: 22500, estado_pago: 'RECHAZADO', aprobado_at: null },
      { cargo_id: 'c2', monto: 10000, estado_pago: 'APROBADO', aprobado_at: '2026-09-30T12:00:00Z' },
    ],
    new Set(['c4']),
    e.hoy,
  );
  assert.equal(t.familias, 2);
  assert.equal(t.familiasPrueba, 1);
  assert.equal(t.conDeuda, 1);
  assert.equal(t.porCobrar, 22500);
  assert.equal(t.vencido, 22500);
  assert.equal(t.recaudadoMes, 10000);
});

test('el mes del pago se calcula en hora de Chile', () => {
  // 1 de octubre 01:00 UTC = 30 de septiembre 22:00 en Chile.
  assert.equal(mesChile('2026-10-01T01:00:00Z'), '2026-09');
  assert.equal(mesChile(null), null);
});

test('valida el cargo manual', () => {
  const base = { apoderadoId: A1, atletaId: null, programa: 'STAR', concepto: 'UNIFORME', descripcion: 'Polera extra', monto: 8000, vencimiento: '2026-10-31' };
  assert.equal(validarCargoManual(base).ok, true);
  assert.equal(validarCargoManual({ ...base, monto: 0 }).ok, false);
  assert.equal(validarCargoManual({ ...base, monto: 10.5 }).ok, false);
  assert.equal(validarCargoManual({ ...base, descripcion: 'x' }).ok, false);
  assert.equal(validarCargoManual({ ...base, programa: 'OTRO' }).ok, false);
  assert.equal(validarCargoManual({ ...base, concepto: 'PACK_COMPETITIVO' }).ok, false, 'pack solo All Star');
  assert.equal(validarCargoManual({ ...base, concepto: 'PACK_COMPETITIVO', programa: 'ALL_STAR' }).ok, true);
  assert.equal(validarCargoManual({ ...base, concepto: 'MENSUALIDAD' }).ok, false, 'mensualidad no es manual');
  assert.equal(validarCargoManual({ ...base, apoderadoId: 'x' }).ok, false);
});

test('limpia el texto de búsqueda', () => {
  assert.equal(textoBusqueda('  Carla (Muñoz), %* '), 'Carla Muñoz');
  assert.equal(textoBusqueda('carla@x.cl'), 'carla@x.cl');
});

test('compara nombres sin tildes ni mayúsculas', () => {
  assert.equal(normalizarBusqueda('  Céspedes  MUÑOZ '), 'cespedes munoz');
});
