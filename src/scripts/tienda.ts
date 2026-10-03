// Página pública /poleras: carrito por talla y pago con Mercado Pago.
// /poleras/gracias: consulta el estado real del pedido (nunca confía en la URL de retorno).

import { MAX_POR_TALLA, MAX_UNIDADES, pesos, textoItems, totalUnidades, validarPedido, type ItemPedido } from '../lib/crm/tienda.ts';

function $<T extends Element>(s: string): T {
  return document.querySelector<T>(s)!;
}

interface ProductoPublico {
  activo: boolean;
  nombre?: string;
  descripcion?: string;
  precio?: number;
  tallas?: string[];
}

export async function iniciarTienda(): Promise<void> {
  let producto: ProductoPublico = { activo: false };
  try {
    const r = await fetch('/api/tienda/producto');
    if (r.ok) producto = (await r.json()) as ProductoPublico;
  } catch {
    /* queda cerrada */
  }
  $<HTMLElement>('#td-cargando').hidden = true;
  if (!producto.activo || !producto.precio || !producto.tallas?.length) {
    $<HTMLElement>('#td-cerrada').hidden = false;
    return;
  }
  const precio = producto.precio;
  const tallas = producto.tallas;
  const cantidades = new Map<string, number>(tallas.map((t) => [t, 0]));

  $<HTMLElement>('#td-nombre').textContent = producto.nombre ?? 'Poleras Firehouse';
  $<HTMLElement>('#td-descripcion').textContent = producto.descripcion ?? '';
  $<HTMLElement>('#td-precio').textContent = pesos(precio);
  const form = $<HTMLFormElement>('#td-form');
  const contenedor = $<HTMLElement>('#td-tallas');
  contenedor.innerHTML = tallas
    .map(
      (t) => `
      <div class="td-talla" data-fila="${t}">
        <span class="td-talla__nombre">Talla <b>${t}</b></span>
        <span class="td-paso">
          <button type="button" data-menos="${t}" aria-label="Quitar una polera talla ${t}" disabled>−</button>
          <output data-cantidad="${t}" aria-label="Cantidad talla ${t}">0</output>
          <button type="button" data-mas="${t}" aria-label="Agregar una polera talla ${t}">+</button>
        </span>
      </div>`,
    )
    .join('');
  form.hidden = false;

  const items = (): ItemPedido[] => tallas.filter((t) => cantidades.get(t)! > 0).map((t) => ({ talla: t, cantidad: cantidades.get(t)! }));
  const pagar = $<HTMLButtonElement>('#td-pagar');

  function dibujar(): void {
    const elegidos = items();
    const unidades = totalUnidades(elegidos);
    tallas.forEach((t) => {
      const n = cantidades.get(t)!;
      contenedor.querySelector<HTMLElement>(`[data-cantidad="${t}"]`)!.textContent = String(n);
      contenedor.querySelector<HTMLButtonElement>(`[data-menos="${t}"]`)!.disabled = n === 0;
      contenedor.querySelector<HTMLButtonElement>(`[data-mas="${t}"]`)!.disabled = n >= MAX_POR_TALLA || unidades >= MAX_UNIDADES;
      contenedor.querySelector<HTMLElement>(`[data-fila="${t}"]`)!.classList.toggle('td-talla--elegida', n > 0);
    });
    $<HTMLElement>('#td-resumen').textContent = unidades
      ? `${unidades} ${unidades === 1 ? 'polera' : 'poleras'}: ${textoItems(elegidos)}`
      : 'Aún no eliges poleras.';
    $<HTMLElement>('#td-total').textContent = pesos(unidades * precio);
    pagar.disabled = unidades === 0;
    pagar.textContent = unidades ? `Pagar ${pesos(unidades * precio)} con Mercado Pago` : 'Pagar con Mercado Pago';
  }

  contenedor.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const t = b.dataset.mas ?? b.dataset.menos;
    if (!t || !cantidades.has(t)) return;
    cantidades.set(t, Math.max(0, Math.min(MAX_POR_TALLA, cantidades.get(t)! + (b.dataset.mas ? 1 : -1))));
    mostrarErrores({});
    dibujar();
  });

  const CAMPOS = ['items', 'apoderado', 'alumno', 'email'] as const;
  function mostrarErrores(errores: Record<string, string>, general = ''): void {
    CAMPOS.forEach((c) => {
      const p = $<HTMLElement>(`#td-error-${c}`);
      p.textContent = errores[c] ?? '';
      p.hidden = !errores[c];
      if (c !== 'items') $<HTMLInputElement>(`#td-${c}`).setAttribute('aria-invalid', String(!!errores[c]));
    });
    const g = $<HTMLElement>('#td-error');
    g.textContent = general;
    g.hidden = !general;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cuerpo = {
      apoderado: $<HTMLInputElement>('#td-apoderado').value,
      alumno: $<HTMLInputElement>('#td-alumno').value,
      email: $<HTMLInputElement>('#td-email').value,
      items: items(),
      sitio: $<HTMLInputElement>('#td-sitio').value,
    };
    const v = validarPedido(cuerpo, { precio, tallas });
    if (!v.ok) {
      mostrarErrores(v.errores);
      const primero = CAMPOS.find((c) => v.errores[c]);
      if (primero && primero !== 'items') $<HTMLInputElement>(`#td-${primero}`).focus();
      else $<HTMLElement>('#td-error-items').scrollIntoView({ block: 'center' });
      return;
    }
    mostrarErrores({});
    pagar.disabled = true;
    pagar.textContent = 'Preparando el pago…';
    try {
      const r = await fetch('/api/tienda/crear-pedido', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const d = (await r.json().catch(() => ({}))) as { url?: string; mensaje?: string; errores?: Record<string, string> };
      if (r.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      mostrarErrores(d.errores ?? {}, d.errores ? '' : d.mensaje ?? 'No pudimos preparar el pago. Inténtalo nuevamente.');
    } catch {
      mostrarErrores({}, 'No pudimos conectar. Revisa tu conexión e inténtalo nuevamente.');
    }
    dibujar();
  });

  dibujar();
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function iniciarGraciasTienda(): Promise<void> {
  const pedido = new URLSearchParams(location.search).get('pedido') ?? '';
  let estado = 'PENDIENTE';
  let total = 0;
  let items: ItemPedido[] = [];
  for (let intento = 0; intento < 8; intento++) {
    try {
      const r = await fetch(`/api/tienda/pedido?pedido=${encodeURIComponent(pedido)}`);
      if (r.ok) {
        const d = (await r.json()) as { estado: string; total: number; items: ItemPedido[] };
        estado = d.estado;
        total = d.total;
        items = d.items ?? [];
        if (estado !== 'PENDIENTE') break;
      } else if (r.status === 404) {
        estado = 'RECHAZADO';
        break;
      }
    } catch {
      /* se reintenta */
    }
    await espera(2500);
  }
  $<HTMLElement>('#tg-cargando').hidden = true;
  if (estado === 'PAGADO') {
    const n = totalUnidades(items);
    $<HTMLElement>('#tg-total').textContent = pesos(total);
    $<HTMLElement>('#tg-items').textContent = `${n} ${n === 1 ? 'polera' : 'poleras'} (${textoItems(items)})`;
    $<HTMLElement>('#tg-pagado').hidden = false;
  } else if (estado === 'PENDIENTE') {
    $<HTMLElement>('#tg-pendiente').hidden = false;
  } else {
    $<HTMLElement>('#tg-rechazado').hidden = false;
  }
}
