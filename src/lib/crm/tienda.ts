// Tienda de poleras (migración 0018). Lógica pura, sin DOM ni red: la usan la
// página pública, los endpoints y el panel.

export const PRODUCTO_POLERA = 'POLERA';
export const MAX_POR_TALLA = 10;
export const MAX_UNIDADES = 30;

export interface ProductoTienda {
  codigo: string;
  nombre: string;
  descripcion: string;
  precio: number;
  tallas: string[];
  activo: boolean;
}

export interface ItemPedido {
  talla: string;
  cantidad: number;
}

export interface DatosPedido {
  apoderado: string;
  alumno: string;
  email: string;
  items: ItemPedido[];
  total: number;
}

const NOMBRE_RE = /^[\p{L}\p{M} .'’-]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function limpiar(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

function nombreValido(t: string): boolean {
  return t.length >= 2 && t.length <= 80 && NOMBRE_RE.test(t);
}

export function pesos(n: number): string {
  return `$${n.toLocaleString('es-CL')}`;
}

export function totalUnidades(items: ItemPedido[]): number {
  return items.reduce((s, i) => s + i.cantidad, 0);
}

export type ValidacionPedido = { ok: true; datos: DatosPedido } | { ok: false; errores: Record<string, string> };

/**
 * Valida lo que envía el navegador contra el producto de la base. El total se
 * calcula siempre aquí con el precio de la base, nunca se recibe del navegador.
 */
export function validarPedido(cuerpo: unknown, producto: Pick<ProductoTienda, 'precio' | 'tallas'>): ValidacionPedido {
  const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
  const errores: Record<string, string> = {};
  const apoderado = limpiar(c.apoderado);
  const alumno = limpiar(c.alumno);
  const email = limpiar(c.email).toLowerCase();

  if (!nombreValido(apoderado)) errores.apoderado = 'Escribe el nombre del apoderado.';
  if (!nombreValido(alumno)) errores.alumno = 'Escribe el nombre del alumno o alumna.';
  if (email.length > 160 || !EMAIL_RE.test(email)) errores.email = 'Escribe un correo válido: ahí te enviamos el comprobante.';

  const porTalla = new Map<string, number>();
  let itemsOk = Array.isArray(c.items);
  for (const crudo of Array.isArray(c.items) ? c.items : []) {
    const i = (crudo ?? {}) as Record<string, unknown>;
    const talla = typeof i.talla === 'string' ? i.talla : '';
    const cantidad = i.cantidad;
    if (!producto.tallas.includes(talla) || typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0) {
      itemsOk = false;
      break;
    }
    if (cantidad > 0) porTalla.set(talla, (porTalla.get(talla) ?? 0) + cantidad);
  }
  // Mismo orden que las tallas del producto.
  const items = producto.tallas.filter((t) => porTalla.has(t)).map((t) => ({ talla: t, cantidad: porTalla.get(t)! }));
  if (!itemsOk) errores.items = 'El pedido no es válido. Recarga la página e inténtalo de nuevo.';
  else if (items.length === 0) errores.items = 'Elige al menos una polera.';
  else if (items.some((i) => i.cantidad > MAX_POR_TALLA)) errores.items = `El máximo es ${MAX_POR_TALLA} poleras por talla.`;
  else if (totalUnidades(items) > MAX_UNIDADES) errores.items = `El máximo es ${MAX_UNIDADES} poleras por pedido.`;

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, datos: { apoderado, alumno, email, items, total: totalUnidades(items) * producto.precio } };
}

/** "2 × M, 1 × L" */
export function textoItems(items: ItemPedido[]): string {
  return items.map((i) => `${i.cantidad} × ${i.talla}`).join(', ');
}

/** Identificador de la compra. El prefijo le dice al webhook de Mercado Pago que es de la tienda. */
export function generarCommerceOrderTienda(ahora: number = Date.now(), azar: string = crypto.randomUUID()): string {
  return `TIENDA-${ahora.toString(36).toUpperCase()}-${azar.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

const COMMERCE_ORDER_RE = /^TIENDA-[0-9A-Z]+-[0-9A-F]{12}$/;
export function esPedidoTienda(commerceOrder: string): boolean {
  return commerceOrder.startsWith('TIENDA-');
}
export function commerceOrderTiendaValido(v: unknown): v is string {
  return typeof v === 'string' && COMMERCE_ORDER_RE.test(v);
}

// ---------------------------------------------------------------------------
// Panel

export interface PedidoPanel {
  id: string;
  estado: string;
  entregado_at: string | null;
  items: ItemPedido[];
}

export type FiltroPedidos = 'POR_ENTREGAR' | 'ENTREGADOS' | 'SIN_PAGAR' | 'TODOS';
export const FILTRO_PEDIDOS_LABEL: Record<FiltroPedidos, string> = {
  POR_ENTREGAR: 'Por entregar',
  ENTREGADOS: 'Entregados',
  SIN_PAGAR: 'Sin pagar',
  TODOS: 'Todos',
};

export function cumpleFiltroPedido(p: Pick<PedidoPanel, 'estado' | 'entregado_at'>, f: FiltroPedidos): boolean {
  switch (f) {
    case 'POR_ENTREGAR':
      return p.estado === 'PAGADO' && !p.entregado_at;
    case 'ENTREGADOS':
      return p.estado === 'PAGADO' && !!p.entregado_at;
    case 'SIN_PAGAR':
      return p.estado !== 'PAGADO';
    default:
      return true;
  }
}

/** Unidades pagadas y aún no entregadas por talla: lo que hay que encargar o tener a mano. */
export function porEntregarPorTalla(pedidos: PedidoPanel[], tallas: string[]): Array<{ talla: string; cantidad: number }> {
  const mapa = new Map<string, number>();
  for (const p of pedidos) {
    if (!cumpleFiltroPedido(p, 'POR_ENTREGAR')) continue;
    for (const i of p.items) mapa.set(i.talla, (mapa.get(i.talla) ?? 0) + i.cantidad);
  }
  const orden = [...tallas, ...[...mapa.keys()].filter((t) => !tallas.includes(t))];
  return orden.filter((t) => mapa.has(t)).map((talla) => ({ talla, cantidad: mapa.get(talla)! }));
}
