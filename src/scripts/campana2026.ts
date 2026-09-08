// Lógica de cliente para /campana-2026.
//
// A diferencia de /sorteo, esta página TODAVÍA NO tiene checkout real: no
// existe un endpoint que cree una orden ni una pasarela habilitada. Por eso
// "Continuar al pago" no llama a ninguna API — abre un aviso que dice que el
// medio de pago está en validación (ver brief de la Campaña Firehouse 2026,
// punto 21) y ofrece WhatsApp como alternativa mientras tanto.
//
// El contador intenta leer /api/campana-2026/contador y, si el endpoint
// todavía no existe (404 o error de red), parte en 0 sin romper la página.
// El nombre del deportista referido sí es real: se resuelve contra
// /api/campana-2026/deportista, que consulta la misma tabla rifa_codigos
// que ya usa /sorteo.

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
    const banner = $<HTMLElement>('#campReferidoBanner');
    const texto = $<HTMLElement>('#campReferidoTexto');
    banner?.removeAttribute('hidden');
    // Mensaje genérico mientras se resuelve el nombre real (o si el código
    // no existe / el endpoint falla, se queda así — nunca rompe la página).
    fetch(`/api/campana-2026/deportista?codigo=${encodeURIComponent(ref)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { nombre?: string } | null) => {
        if (data?.nombre && texto) {
          texto.textContent = `Estás apoyando a ${data.nombre}`;
        }
      })
      .catch(() => {
        // Se queda con el mensaje genérico ya visible.
      });
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
      // Todavía no hay endpoint ni compras reales: partimos en 0 sin avisar con un
      // toast, porque este es el estado normal antes del lanzamiento, no un error.
      pintarContador(0, 0, 0);
    }
  }
  cargarContador();

  // ---------- Selección de sobres + carrito fijo (oculto hasta elegir algo) ----------
  const cart = $<HTMLElement>('#campCart');
  const cartChips = $<HTMLElement>('#campCartChips');
  const cartTotal = $<HTMLElement>('#campCartTotal');
  const cartPagarBtn = $<HTMLButtonElement>('#campCartPagar');
  const seleccion = new Set<string>();

  function resumenSeleccion(): { texto: string; total: number } {
    let total = 0;
    const nombres: string[] = [];
    seleccion.forEach((id) => {
      const p = PRODUCTOS[id];
      if (!p) return;
      total += p.precio;
      nombres.push(p.nombre);
    });
    return { texto: nombres.join(', '), total };
  }

  function actualizarCarrito(): void {
    if (!cart || !cartChips || !cartTotal || !cartPagarBtn) return;
    const hayAlgo = seleccion.size > 0;
    cart.classList.toggle('activo', hayAlgo);
    if (!hayAlgo) return;

    cartChips.innerHTML = '';
    seleccion.forEach((id) => {
      const p = PRODUCTOS[id];
      if (!p) return;
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

    const { total } = resumenSeleccion();
    cartTotal.textContent = formatoCLP.format(total);
    cartPagarBtn.textContent = `❤️‍🔥 Confirmar apoyo — ${formatoCLP.format(total)}`;
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
  const avisoResumen = $<HTMLElement>('#campAvisoResumen');
  const avisoTexto = $<HTMLElement>('#campAvisoTexto');
  const avisoWa = $<HTMLAnchorElement>('#campAvisoWa');

  function abrirAviso(opts: { titulo: string; resumen?: string; texto: string; waHref: string }): void {
    if (!aviso || !avisoTitulo || !avisoTexto) return;
    avisoTitulo.textContent = opts.titulo;
    avisoTexto.textContent = opts.texto;
    if (avisoResumen) {
      if (opts.resumen) {
        avisoResumen.textContent = opts.resumen;
        avisoResumen.removeAttribute('hidden');
      } else {
        avisoResumen.setAttribute('hidden', '');
      }
    }
    if (avisoWa) avisoWa.href = opts.waHref;
    aviso.removeAttribute('hidden');
  }
  function cerrarAviso(): void {
    aviso?.setAttribute('hidden', '');
  }
  avisoFondo?.addEventListener('click', cerrarAviso);
  avisoCerrar?.addEventListener('click', cerrarAviso);

  cartPagarBtn?.addEventListener('click', () => {
    if (seleccion.size === 0) {
      mostrarToast('Elige al menos un sobre para continuar');
      return;
    }
    const { texto, total } = resumenSeleccion();
    const waHref = $<HTMLAnchorElement>('#campAvisoWaPago')?.getAttribute('href') ?? '#';
    abrirAviso({
      titulo: 'Medio de pago en proceso de validación',
      resumen: `Estás apoyando a Firehouse con: ${texto} — ${formatoCLP.format(total)}`,
      texto: 'Estamos terminando de habilitar el pago en línea con Flow. Escríbenos por WhatsApp y te avisamos apenas puedas completar tu compra.',
      waHref,
    });
  });

  $('#campGratisBtn')?.addEventListener('click', () => {
    const waHref = $<HTMLAnchorElement>('#campAvisoWaGratis')?.getAttribute('href') ?? '#';
    abrirAviso({
      titulo: 'Muy pronto',
      texto: 'La participación sin compra se habilita junto con las bases de la promoción. Escríbenos por WhatsApp y te avisamos apenas esté disponible.',
      waHref,
    });
  });

  // ---------- Compartir ----------
  const mensajeCompartir =
    'Estoy apoyando a Firehouse en la Campaña 2026 🔥 Elige tu sobre Blaze o Nova, apoya a nuestro equipo y participa por grandes premios:';

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
