// Lógica de cliente para /campana-2026.
//
// El checkout ya es real: al confirmar, este archivo llama a
// /api/campana-2026/crear-orden. Mientras campana_config.checkout_habilitado
// siga en false (default hasta que Flow apruebe el modelo), ese endpoint
// responde 403 checkout_deshabilitado y acá mostramos el aviso de "medio de
// pago en proceso de validación" en vez de redirigir a pagar — nadie llega a
// pagar por error mientras el modelo sigue en revisión.
//
// El contador intenta leer /api/campana-2026/contador y, si el endpoint
// todavía no existe (404 o error de red), parte en 0 sin romper la página.
// El nombre del deportista referido sí es real: se resuelve contra
// /api/campana-2026/deportista, que consulta la misma tabla rifa_codigos
// que ya usa /sorteo.

interface Producto {
  id: string;
  codigoBackend: string;
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
  blaze: { id: 'blaze', codigoBackend: 'BLAZE', nombre: 'Sobre Blaze', precio: 3000 },
  nova: { id: 'nova', codigoBackend: 'NOVA', nombre: 'Sobre Nova', precio: 3000 },
  'blaze-nova': { id: 'blaze-nova', codigoBackend: 'BLAZE_NOVA', nombre: 'Pack Blaze + Nova', precio: 5000 },
};

const formatoCLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatearTelefonoInput(input: HTMLInputElement | null): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const digitos = input.value.replace(/\D/g, '').slice(0, 9);
    if (digitos.length <= 1) { input.value = digitos; return; }
    const resto = digitos.slice(1);
    input.value = resto.length > 4 ? `${digitos[0]} ${resto.slice(0, 4)} ${resto.slice(4)}` : `${digitos[0]} ${resto}`;
  });
}

function inicializarFeedbackEmail(input: HTMLInputElement | null, feedback: HTMLElement | null): void {
  if (!input || !feedback) return;
  const actualizar = () => {
    const valor = input.value.trim();
    if (!valor) { feedback.textContent = ''; feedback.className = 'camp-campo__validacion'; return; }
    const valido = EMAIL_RE.test(valor);
    feedback.textContent = valido ? '' : 'Revisa el formato del correo.';
    feedback.className = `camp-campo__validacion ${valido ? 'valido' : 'invalido'}`;
  };
  input.addEventListener('input', actualizar);
  input.addEventListener('blur', actualizar);
}

function inicializarEstadoTocado(form: HTMLFormElement): void {
  form.addEventListener('blur', (evt) => {
    const el = evt.target as HTMLElement;
    if (el instanceof HTMLInputElement) el.classList.add('tocado');
  }, true);
}
function inicializarEstadoConContenido(form: HTMLFormElement): void {
  form.addEventListener('input', (evt) => {
    const el = evt.target as HTMLInputElement;
    el.classList.toggle('con-contenido', el.value.trim().length > 0);
  });
}

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
  const contDesglose = $<HTMLElement>('#campContDesglose');

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
    // A propósito: nunca se inventan ventas, pero tampoco se le muestra a la
    // primera persona que visita la página un desglose en 0 — eso se ve como
    // prueba social negativa. El desglose aparece solo, apenas hay una venta real.
    contDesglose?.toggleAttribute('hidden', !hayVentas);
  }

  async function cargarContador(): Promise<void> {
    try {
      const res = await fetch('/api/campana-2026/contador');
      if (!res.ok) throw new Error('sin_endpoint');
      const data = (await res.json()) as { blaze?: number; nova?: number; pack?: number };
      pintarContador(data.blaze ?? 0, data.nova ?? 0, data.pack ?? 0);
    } catch {
      // Todavía no hay compras reales: partimos en 0 sin avisar con un toast,
      // porque este es el estado normal antes del lanzamiento, no un error.
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

  // ---------- Aviso (checkout deshabilitado / participación gratuita) ----------
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

  // ---------- Modal de datos del comprador + checkout real ----------
  const modal = $<HTMLElement>('#campModalDatos');
  const modalFondo = $<HTMLElement>('#campModalFondo');
  const modalCerrar = $<HTMLButtonElement>('#campModalCerrar');
  const modalResumen = $<HTMLElement>('#campModalResumen');
  const form = $<HTMLFormElement>('#campFormDatos');
  const nombreInput = $<HTMLInputElement>('#campNombre');
  const emailInput = $<HTMLInputElement>('#campEmail');
  const emailFeedback = $<HTMLElement>('#campEmailFeedback');
  const telefonoInput = $<HTMLInputElement>('#campTelefono');
  const formError = $<HTMLElement>('#campFormError');
  const enviarBtn = $<HTMLButtonElement>('#campModalEnviar');

  formatearTelefonoInput(telefonoInput);
  inicializarFeedbackEmail(emailInput, emailFeedback);
  if (form) {
    inicializarEstadoTocado(form);
    inicializarEstadoConContenido(form);
  }

  function abrirModal(): void {
    if (!modal || !modalResumen) return;
    const { texto, total } = resumenSeleccion();
    modalResumen.textContent = `${texto} — ${formatoCLP.format(total)}`;
    formError?.setAttribute('hidden', '');
    modal.removeAttribute('hidden');
  }
  function cerrarModal(): void {
    modal?.setAttribute('hidden', '');
  }
  modalFondo?.addEventListener('click', cerrarModal);
  modalCerrar?.addEventListener('click', cerrarModal);

  cartPagarBtn?.addEventListener('click', () => {
    if (seleccion.size === 0) {
      mostrarToast('Elige al menos un sobre para continuar');
      return;
    }
    abrirModal();
  });

  form?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const nombre = nombreInput?.value.trim() ?? '';
    const email = emailInput?.value.trim() ?? '';
    const telefono = telefonoInput?.value.trim() ?? '';
    const telefonoDigitos = telefono.replace(/\D/g, '');

    if (nombre.length < 3 || !EMAIL_RE.test(email) || telefonoDigitos.length < 8) {
      formError?.removeAttribute('hidden');
      return;
    }
    formError?.setAttribute('hidden', '');

    const productos = [...seleccion].map((id) => PRODUCTOS[id]?.codigoBackend).filter(Boolean);
    if (enviarBtn) { enviarBtn.disabled = true; enviarBtn.textContent = 'Procesando…'; }

    try {
      const res = await fetch('/api/campana-2026/crear-orden', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productos,
          comprador: { nombre, email, telefono: `+56${telefonoDigitos}` },
          ref: ref ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.error === 'checkout_deshabilitado') {
        cerrarModal();
        const { texto, total } = resumenSeleccion();
        const waHref = $<HTMLAnchorElement>('#campAvisoWaPago')?.getAttribute('href') ?? '#';
        abrirAviso({
          titulo: 'Medio de pago en proceso de validación',
          resumen: `Estás apoyando a Firehouse con: ${texto} — ${formatoCLP.format(total)}`,
          texto: 'Estamos terminando de habilitar el pago en línea con Flow. Escríbenos por WhatsApp y te avisamos apenas puedas completar tu compra.',
          waHref,
        });
        return;
      }

      mostrarToast('No pudimos iniciar el pago. Inténtalo de nuevo en un momento.');
    } catch {
      mostrarToast('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      if (enviarBtn) { enviarBtn.disabled = false; enviarBtn.textContent = 'Continuar al pago'; }
    }
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
