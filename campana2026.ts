// Lógica de cliente para /campana-2026.
//
// A diferencia de /sorteo, esta página TODAVÍA NO tiene backend de compra:
// no existe un endpoint que cree una orden ni una pasarela habilitada. Por
// eso "Continuar al pago" no llama a ninguna API — abre un aviso que dice
// que el medio de pago está en validación (ver brief de la Campaña Firehouse
// 2026, punto 21) y ofrece WhatsApp como alternativa mientras tanto.
//
// El contador intenta leer /api/campana-2026/contador y, si el endpoint
// todavía no existe (404 o error de red), parte en 0 sin romper la página.
// Cuando se cree ese endpoint (y la tabla de órdenes detrás), esto empieza
// a mostrar números reales sin tocar el resto del archivo.

interface Producto {
  id: string;
  nombre: string;
  precio: number;
}

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}
function $all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

const PRODUCTOS: Record<string, Producto> = {
  blaze: { id: 'blaze', nombre: 'Sobre Blaze', precio: 3000 },
  nova: { id: 'nova', nombre: 'Sobre Nova', precio: 3000 },
  'blaze-nova': { id: 'blaze-nova', nombre: 'Pack Blaze + Nova', precio: 5000 },
};

const formatoCLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

export function iniciarCampana2026(): void {
  // ---------- Referido por deportista (?ref=FH-XXXXXX) ----------
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) {
    $('#campReferidoBanner')?.removeAttribute('hidden');
  }

  // ---------- Toast ----------
  const toast = $<HTMLElement>('#campToast');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function mostrarToast(msg: string): void {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('activo');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('activo'), 3200);
  }

  // ---------- Contador de campaña ----------
  const META = 800;
  const contInicio = $<HTMLElement>('#campContInicio');
  const contNormal = $<HTMLElement>('#campContNormal');
  const contNum = $<HTMLElement>('#campContNum');
  const contFill = $<HTMLElement>('#campContFill');
  const contBlaze = $<HTMLElement>('#campContBlaze');
  const contNova = $<HTMLElement>('#campContNova');
  const contPack = $<HTMLElement>('#campContPack');

  function pintarContador(blaze: number, nova: number, pack: number): void {
    const total = blaze + nova + pack;
    if (contBlaze) contBlaze.textContent = String(blaze);
    if (contNova) contNova.textContent = String(nova);
    if (contPack) contPack.textContent = String(pack);
    if (contNum) contNum.textContent = String(total);
    if (contFill) contFill.style.width = `${Math.min(100, (total / META) * 100)}%`;
    const hayVentas = total > 0;
    contInicio?.toggleAttribute('hidden', hayVentas);
    contNormal?.toggleAttribute('hidden', !hayVentas);
  }

  async function cargarContador(): Promise<void> {
    try {
      const res = await fetch('/api/campana-2026/contador');
      if (!res.ok) throw new Error('sin_endpoint');
      const data = (await res.json()) as { blaze?: number; nova?: number; pack?: number };
      pintarContador(data.blaze ?? 0, data.nova ?? 0, data.pack ?? 0);
    } catch {
      // Todavía no hay endpoint ni compras reales: partimos en 0 sin avisar con un toast,
      // porque este es el estado normal antes del lanzamiento, no un error visible.
      pintarContador(0, 0, 0);
    }
  }
  cargarContador();

  // ---------- Selección de sobres (carrito) ----------
  const cart = $<HTMLElement>('#campCart');
  const cartChips = $<HTMLElement>('#campCartChips');
  const cartTotal = $<HTMLElement>('#campCartTotal');
  const seleccion = new Set<string>();

  function actualizarCarrito(): void {
    if (!cart || !cartChips || !cartTotal) return;
    cartChips.innerHTML = '';
    let total = 0;
    seleccion.forEach((id) => {
      const p = PRODUCTOS[id];
      if (!p) return;
      total += p.precio;
      const chip = document.createElement('span');
      chip.className = 'camp-chip';
      chip.append(p.nombre);
      const btnQuitar = document.createElement('button');
      btnQuitar.type = 'button';
      btnQuitar.textContent = '×';
      btnQuitar.setAttribute('aria-label', `Quitar ${p.nombre}`);
      btnQuitar.addEventListener('click', () => toggleProducto(id, false));
      chip.appendChild(btnQuitar);
      cartChips.appendChild(chip);
    });
    cartTotal.textContent = formatoCLP.format(total);
    cart?.classList.toggle('activo', seleccion.size > 0);
  }

  function toggleProducto(id: string, forzar?: boolean): void {
    const activar = forzar ?? !seleccion.has(id);
    if (activar) seleccion.add(id);
    else seleccion.delete(id);

    $all<HTMLButtonElement>(`[data-camp-producto="${id}"]`).forEach((btn) => {
      btn.classList.toggle('activo', activar);
      btn.textContent = activar ? '✓ Agregado' : (btn.dataset.textoOriginal ?? btn.textContent ?? '');
    });
    actualizarCarrito();
  }

  $all<HTMLButtonElement>('[data-camp-producto]').forEach((btn) => {
    btn.dataset.textoOriginal = btn.textContent ?? '';
    btn.addEventListener('click', () => toggleProducto(btn.dataset.campProducto!));
  });

  // ---------- Aviso (pago / participación gratuita) ----------
  const aviso = $<HTMLElement>('#campAviso');
  const avisoFondo = $<HTMLElement>('#campAvisoFondo');
  const avisoCerrar = $<HTMLButtonElement>('#campAvisoCerrar');
  const avisoTitulo = $<HTMLElement>('#campAvisoTitulo');
  const avisoTexto = $<HTMLElement>('#campAvisoTexto');
  const avisoWa = $<HTMLAnchorElement>('#campAvisoWa');

  function abrirAviso(titulo: string, texto: string, waHref: string): void {
    if (!aviso || !avisoTitulo || !avisoTexto) return;
    avisoTitulo.textContent = titulo;
    avisoTexto.textContent = texto;
    if (avisoWa) avisoWa.href = waHref;
    aviso.removeAttribute('hidden');
  }
  function cerrarAviso(): void {
    aviso?.setAttribute('hidden', '');
  }
  avisoFondo?.addEventListener('click', cerrarAviso);
  avisoCerrar?.addEventListener('click', cerrarAviso);

  $('#campCartPagar')?.addEventListener('click', () => {
    if (seleccion.size === 0) {
      mostrarToast('Elige al menos un sobre para continuar');
      return;
    }
    const waHref = $<HTMLAnchorElement>('#campAvisoWaPago')?.getAttribute('href') ?? '#';
    abrirAviso(
      'Medio de pago en proceso de validación',
      'Estamos terminando de habilitar el pago en línea con Flow. Escríbenos por WhatsApp y te avisamos apenas puedas completar tu compra.',
      waHref,
    );
  });

  $('#campGratisBtn')?.addEventListener('click', () => {
    const waHref = $<HTMLAnchorElement>('#campAvisoWaGratis')?.getAttribute('href') ?? '#';
    abrirAviso(
      'Muy pronto',
      'La participación sin compra se habilita junto con las bases de la promoción. Escríbenos por WhatsApp y te avisamos apenas esté disponible.',
      waHref,
    );
  });

  // ---------- Compartir ----------
  const mensajeCompartir =
    'Estoy participando en la Campaña Firehouse 2026 🔥 Elige tu sobre Blaze o Nova, apoya a nuestro equipo y participa por grandes premios:';

  $('[data-camp-compartir="whatsapp"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const url = `https://wa.me/?text=${encodeURIComponent(`${mensajeCompartir} ${window.location.href}`)}`;
    window.open(url, '_blank', 'noopener');
  });

  $('[data-camp-compartir="instagram"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(window.location.href);
      mostrarToast('Enlace copiado — pégalo en tu historia de Instagram');
    } catch {
      mostrarToast('No pudimos copiar el enlace, cópialo manualmente');
    }
  });
}
