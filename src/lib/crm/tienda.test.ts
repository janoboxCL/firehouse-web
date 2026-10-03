import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commerceOrderTiendaValido,
  cumpleFiltroPedido,
  esPedidoTienda,
  generarCommerceOrderTienda,
  porEntregarPorTalla,
  textoItems,
  validarPedido,
} from './tienda.ts';

const producto = { precio: 12000, tallas: ['10', '12', '14', 'S', 'M', 'L', 'XL'] };
const base = { apoderado: ' Carolina  Rojas ', alumno: 'Sofía', email: ' Caro@Correo.cl ', items: [{ talla: 'M', cantidad: 2 }, { talla: '10', cantidad: 1 }] };

test('pedido válido: limpia datos, ordena tallas y calcula el total con el precio de la base', () => {
  const v = validarPedido({ ...base, total: 1, precio: 1 }, producto);
  assert.ok(v.ok);
  assert.deepEqual(v.datos, {
    apoderado: 'Carolina Rojas',
    alumno: 'Sofía',
    email: 'caro@correo.cl',
    items: [{ talla: '10', cantidad: 1 }, { talla: 'M', cantidad: 2 }],
    total: 36000,
  });
});

test('tallas repetidas se suman y las cantidades en cero se ignoran', () => {
  const v = validarPedido({ ...base, items: [{ talla: 'L', cantidad: 1 }, { talla: 'L', cantidad: 2 }, { talla: 'S', cantidad: 0 }] }, producto);
  assert.ok(v.ok);
  assert.deepEqual(v.datos.items, [{ talla: 'L', cantidad: 3 }]);
});

test('errores por campo', () => {
  const v = validarPedido({ apoderado: '', alumno: 'X1', email: 'no-es-correo', items: [] }, producto);
  assert.ok(!v.ok);
  assert.deepEqual(Object.keys(v.errores).sort(), ['alumno', 'apoderado', 'email', 'items']);
});

test('rechaza tallas inexistentes, cantidades no enteras o negativas y pedidos excesivos', () => {
  const mal = (items: unknown) => {
    const v = validarPedido({ ...base, items }, producto);
    return !v.ok && !!v.errores.items;
  };
  assert.ok(mal([{ talla: 'XXL', cantidad: 1 }]));
  assert.ok(mal([{ talla: 'M', cantidad: 1.5 }]));
  assert.ok(mal([{ talla: 'M', cantidad: -1 }]));
  assert.ok(mal([{ talla: 'M', cantidad: '2' }]));
  assert.ok(mal([{ talla: 'M', cantidad: 11 }]));
  assert.ok(mal('x'));
  assert.ok(mal(producto.tallas.map((talla) => ({ talla, cantidad: 5 }))));
  assert.ok(!validarPedido(null, producto).ok);
});

test('identificador de compra', () => {
  const co = generarCommerceOrderTienda(1_790_000_000_000, 'abcdef12-3456-7890-abcd-ef1234567890');
  assert.ok(commerceOrderTiendaValido(co), co);
  assert.ok(esPedidoTienda(co));
  assert.ok(!esPedidoTienda('STAR-1-abc'));
  assert.ok(!commerceOrderTiendaValido('TIENDA-1'));
  assert.ok(!commerceOrderTiendaValido(null));
});

test('panel: filtros y unidades por entregar por talla', () => {
  const pedidos = [
    { id: '1', estado: 'PAGADO', entregado_at: null, items: [{ talla: 'M', cantidad: 2 }, { talla: '10', cantidad: 1 }] },
    { id: '2', estado: 'PAGADO', entregado_at: '2026-10-10T20:00:00Z', items: [{ talla: 'M', cantidad: 1 }] },
    { id: '3', estado: 'PENDIENTE', entregado_at: null, items: [{ talla: 'L', cantidad: 4 }] },
    { id: '4', estado: 'PAGADO', entregado_at: null, items: [{ talla: 'M', cantidad: 1 }] },
  ];
  assert.deepEqual(porEntregarPorTalla(pedidos, producto.tallas), [{ talla: '10', cantidad: 1 }, { talla: 'M', cantidad: 3 }]);
  assert.deepEqual(pedidos.filter((p) => cumpleFiltroPedido(p, 'POR_ENTREGAR')).map((p) => p.id), ['1', '4']);
  assert.deepEqual(pedidos.filter((p) => cumpleFiltroPedido(p, 'ENTREGADOS')).map((p) => p.id), ['2']);
  assert.deepEqual(pedidos.filter((p) => cumpleFiltroPedido(p, 'SIN_PAGAR')).map((p) => p.id), ['3']);
  assert.equal(textoItems(pedidos[0].items), '2 × M, 1 × 10');
});
