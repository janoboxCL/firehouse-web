// Panel de poleras (migración 0018): pedidos de la tienda, entrega en el
// gimnasio y configuración de la venta (precio y si está activa).

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import { escaparHtml, mensajeErrorSupabase } from '../lib/crm/format.ts';
import { normalizar } from '../lib/crm/clase-prueba-lista.ts';
import {
  cumpleFiltroPedido,
  FILTRO_PEDIDOS_LABEL,
  pesos,
  porEntregarPorTalla,
  PRODUCTO_POLERA,
  textoItems,
  totalUnidades,
  type FiltroPedidos,
  type ItemPedido,
  type ProductoTienda,
} from '../lib/crm/tienda.ts';
import { $, descargarCsv } from './crm-datos.ts';

interface Pedido {
  id: string;
  commerce_order: string;
  apoderado_nombre: string;
  alumno_nombre: string;
  email: string;
  monto_total: number;
  estado: string;
  pagado_at: string | null;
  entregado_at: string | null;
  created_at: string;
  items: ItemPedido[];
}

let PRODUCTO: ProductoTienda | null = null;
let PEDIDOS: Pedido[] = [];
let FILTRO: FiltroPedidos = 'POR_ENTREGAR';
let USUARIO = '';

const ESTADO_LABEL: Record<string, [string, string]> = {
  PAGADO: ['Pagado', 'ok'],
  PENDIENTE: ['Sin pagar', 'pendiente'],
  RECHAZADO: ['Pago rechazado', 'alerta'],
  ANULADO: ['Anulado', 'alerta'],
  REEMBOLSADO: ['Reembolsado', 'alerta'],
};

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })
    .format(new Date(iso))
    .replace('.', '');
}

function mostrarError(texto: string): void {
  const e = $<HTMLElement>('#po-error')!;
  e.textContent = texto;
  e.hidden = false;
}

async function cargar(supabase: SupabaseClient): Promise<boolean> {
  const [prod, ped] = await Promise.all([
    supabase.from('tienda_productos').select('codigo, nombre, descripcion, precio, tallas, activo').eq('codigo', PRODUCTO_POLERA).maybeSingle(),
    supabase
      .from('tienda_pedidos')
      .select('id, commerce_order, apoderado_nombre, alumno_nombre, email, monto_total, estado, pagado_at, entregado_at, created_at, items:tienda_pedido_items ( talla, cantidad )')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);
  if (prod.error || ped.error || !prod.data) {
    const aviso = $<HTMLElement>('#po-aviso')!;
    aviso.textContent = 'Para vender poleras por la página falta ejecutar la migración 0018 en el SQL Editor de Supabase.';
    aviso.hidden = false;
    return false;
  }
  PRODUCTO = prod.data as ProductoTienda;
  const orden = PRODUCTO.tallas;
  PEDIDOS = ((ped.data ?? []) as unknown as Pedido[]).map((p) => ({
    ...p,
    items: [...(p.items ?? [])].sort((a, b) => orden.indexOf(a.talla) - orden.indexOf(b.talla)),
  }));
  return true;
}

function pedidoHtml(p: Pedido): string {
  const [texto, clase] = ESTADO_LABEL[p.estado] ?? [p.estado, 'pendiente'];
  const pagado = p.estado === 'PAGADO';
  const entregado = pagado && !!p.entregado_at;
  const n = totalUnidades(p.items);
  return `
    <article class="po-pedido${entregado ? ' po-pedido--entregado' : ''}">
      <div class="po-pedido__textos">
        <span class="po-pedido__nombre">${escaparHtml(p.alumno_nombre)}<span class="po-etiqueta po-etiqueta--${clase}">${escaparHtml(texto)}</span></span>
        <span class="po-pedido__tallas"><b>${escaparHtml(textoItems(p.items))}</b> · ${n} ${n === 1 ? 'polera' : 'poleras'} · ${pesos(p.monto_total)}</span>
        <span class="po-pedido__detalle">Apoderado: ${escaparHtml(p.apoderado_nombre)} · ${escaparHtml(p.email)}</span>
        <span class="po-pedido__detalle">${pagado && p.pagado_at ? `Pagado el ${fechaHora(p.pagado_at)}` : `Iniciado el ${fechaHora(p.created_at)}`}${
          entregado ? ` · Entregado el ${fechaHora(p.entregado_at!)}` : ''
        } · ${escaparHtml(p.commerce_order)}</span>
      </div>
      ${
        pagado
          ? entregado
            ? `<button type="button" class="admin-btn po-entregar po-entregar--hecho" data-entregar="${p.id}" data-valor="0" aria-label="Deshacer entrega de ${escaparHtml(p.alumno_nombre)}">✓ Entregado</button>`
            : `<button type="button" class="admin-btn po-entregar" data-entregar="${p.id}" data-valor="1">Marcar entregado</button>`
          : ''
      }
    </article>`;
}

function dibujar(): void {
  if (!PRODUCTO) return;
  const pagados = PEDIDOS.filter((p) => p.estado === 'PAGADO');
  $<HTMLElement>('#po-k-pedidos')!.textContent = String(pagados.length);
  $<HTMLElement>('#po-k-recaudado')!.textContent = pesos(pagados.reduce((s, p) => s + p.monto_total, 0));
  const porTalla = porEntregarPorTalla(PEDIDOS, PRODUCTO.tallas);
  $<HTMLElement>('#po-k-entregar')!.textContent = String(porTalla.reduce((s, t) => s + t.cantidad, 0));
  $<HTMLElement>('#po-tallas-wrap')!.hidden = porTalla.length === 0;
  $<HTMLElement>('#po-tallas')!.innerHTML = porTalla
    .map((t) => `<div class="po-talla"><b>${t.cantidad}</b><span>Talla ${escaparHtml(t.talla)}</span></div>`)
    .join('');

  $<HTMLElement>('#po-filtro')!.innerHTML = (Object.keys(FILTRO_PEDIDOS_LABEL) as FiltroPedidos[])
    .map((f) => `<button type="button" data-filtro="${f}" aria-pressed="${f === FILTRO}">${FILTRO_PEDIDOS_LABEL[f]} · ${PEDIDOS.filter((p) => cumpleFiltroPedido(p, f)).length}</button>`)
    .join('');

  const q = normalizar($<HTMLInputElement>('#po-buscar')!.value);
  const visibles = PEDIDOS.filter(
    (p) => cumpleFiltroPedido(p, FILTRO) && (!q || normalizar(`${p.alumno_nombre} ${p.apoderado_nombre} ${p.email} ${p.commerce_order}`).includes(q)),
  );
  $<HTMLElement>('#po-lista')!.innerHTML = visibles.map(pedidoHtml).join('');
  const vacio = $<HTMLElement>('#po-vacio')!;
  vacio.hidden = visibles.length > 0;
  vacio.textContent = PEDIDOS.length === 0 ? 'Todavía no hay pedidos.' : q ? 'Ningún pedido coincide con la búsqueda.' : FILTRO === 'POR_ENTREGAR' ? 'No hay poleras por entregar.' : 'No hay pedidos en esta vista.';
  $<HTMLElement>('#po-excel')!.hidden = pagados.length === 0;

  const estado = $<HTMLElement>('#po-estado-venta')!;
  estado.textContent = PRODUCTO.activo ? 'A la venta' : 'Desactivada';
  estado.className = `po-etiqueta po-etiqueta--${PRODUCTO.activo ? 'ok' : 'pendiente'}`;
}

function llenarFormulario(): void {
  if (!PRODUCTO) return;
  $<HTMLInputElement>('#po-nombre')!.value = PRODUCTO.nombre;
  $<HTMLInputElement>('#po-precio')!.value = PRODUCTO.precio ? PRODUCTO.precio.toLocaleString('es-CL') : '';
  $<HTMLInputElement>('#po-descripcion')!.value = PRODUCTO.descripcion;
  $<HTMLInputElement>('#po-activo')!.checked = PRODUCTO.activo;
  $<HTMLElement>('#po-tallas-texto')!.textContent = PRODUCTO.tallas.join(', ');
  // Mientras no esté a la venta, la configuración queda a la vista.
  $<HTMLDetailsElement>('#po-config')!.open = !PRODUCTO.activo;
}

function conectar(supabase: SupabaseClient): void {
  $('#po-filtro')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filtro]');
    if (!b) return;
    FILTRO = b.dataset.filtro as FiltroPedidos;
    dibujar();
  });
  $('#po-buscar')!.addEventListener('input', dibujar);

  $('#po-lista')!.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-entregar]');
    if (!b) return;
    const pedido = PEDIDOS.find((p) => p.id === b.dataset.entregar);
    if (!pedido) return;
    const entregar = b.dataset.valor === '1';
    if (!entregar && !confirm(`¿Deshacer la entrega de ${pedido.alumno_nombre}?`)) return;
    b.disabled = true;
    const entregado_at = entregar ? new Date().toISOString() : null;
    const { error } = await supabase
      .from('tienda_pedidos')
      .update({ entregado_at, entregado_por: entregar ? USUARIO : null })
      .eq('id', pedido.id);
    if (error) {
      mostrarError(mensajeErrorSupabase(error, 'No pudimos guardar la entrega. Inténtalo nuevamente.'));
      b.disabled = false;
      return;
    }
    $<HTMLElement>('#po-error')!.hidden = true;
    pedido.entregado_at = entregado_at;
    dibujar();
  });

  $('#po-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!PRODUCTO) return;
    const guardado = $<HTMLElement>('#po-guardado')!;
    const nombre = $<HTMLInputElement>('#po-nombre')!.value.trim();
    const precio = Number($<HTMLInputElement>('#po-precio')!.value.replace(/\D/g, ''));
    const activo = $<HTMLInputElement>('#po-activo')!.checked;
    if (nombre.length < 2) return void (guardado.textContent = 'Escribe el nombre de la polera.');
    if (!Number.isInteger(precio) || precio < 0 || precio > 500000) return void (guardado.textContent = 'Revisa el precio.');
    if (activo && precio <= 0) return void (guardado.textContent = 'Para ponerla a la venta, primero ingresa el precio.');
    const cambios = { nombre, precio, descripcion: $<HTMLInputElement>('#po-descripcion')!.value.trim(), activo, updated_at: new Date().toISOString() };
    guardado.textContent = 'Guardando…';
    const { error } = await supabase.from('tienda_productos').update(cambios).eq('codigo', PRODUCTO_POLERA);
    if (error) {
      guardado.textContent = mensajeErrorSupabase(error, 'No pudimos guardar. Inténtalo nuevamente.');
      return;
    }
    PRODUCTO = { ...PRODUCTO, ...cambios };
    $<HTMLInputElement>('#po-precio')!.value = precio ? precio.toLocaleString('es-CL') : '';
    guardado.textContent = activo ? `Guardado ✓ · A la venta a ${pesos(precio)}` : 'Guardado ✓ · La venta está desactivada';
    dibujar();
  });

  $('#po-copiar')!.addEventListener('click', async () => {
    const link = `${location.origin}/poleras`;
    const guardado = $<HTMLElement>('#po-guardado')!;
    try {
      await navigator.clipboard.writeText(link);
      guardado.textContent = `Link copiado: ${link}`;
    } catch {
      guardado.textContent = link;
    }
  });

  $('#po-excel')!.addEventListener('click', () => {
    const filas: Array<Array<string | number>> = [['Alumno', 'Apoderado', 'Correo', 'Talla', 'Cantidad', 'Total del pedido', 'Pagado', 'Entregado', 'N° de pedido']];
    PEDIDOS.filter((p) => p.estado === 'PAGADO').forEach((p) =>
      p.items.forEach((i) =>
        filas.push([p.alumno_nombre, p.apoderado_nombre, p.email, i.talla, i.cantidad, p.monto_total, p.pagado_at ? fechaHora(p.pagado_at) : '', p.entregado_at ? fechaHora(p.entregado_at) : 'No', p.commerce_order]),
      ),
    );
    descargarCsv('pedidos-poleras.csv', filas);
  });
}

export async function iniciarAdminPoleras(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);
  USUARIO = perfil.user_id;
  const ok = await cargar(supabase);
  $<HTMLElement>('#po-cargando')!.hidden = true;
  if (!ok) return;
  $<HTMLElement>('#po-contenido')!.hidden = false;
  llenarFormulario();
  conectar(supabase);
  dibujar();
}
