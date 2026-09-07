// Lógica interactiva de /sorteo: selección de tickets (manual o al azar), upsell de
// pack de 2, chips de selección, datos del comprador y conexión real con el
// backend (Supabase + Flow) a través de /api/sorteo/*.

const TOTAL_NUMEROS = 800;

type EstadoNumero = 'disponible' | 'reservado' | 'vendido' | 'seleccionado';

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}
function $all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trae el estado real de los 800 tickets desde el backend. Si por algo falla
 * (sin conexión, backend caído), no rompe la página: deja todo "disponible"
 * y avisa con un toast, para que al menos se pueda seguir mirando la interfaz. */
async function cargarEstadosReales(avisarSiFalla: (msg: string) => void): Promise<Record<number, EstadoNumero>> {
  try {
    const res = await fetch('/api/sorteo/numeros');
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    const estados: Record<number, EstadoNumero> = {};
    for (const fila of data.numeros as { numero: number; estado: string }[]) {
      estados[fila.numero] = fila.estado.toLowerCase() as EstadoNumero;
    }
    return estados;
  } catch {
    avisarSiFalla('No pudimos cargar el estado real de los tickets — mostrando todos como disponibles.');
    const estados: Record<number, EstadoNumero> = {};
    for (let i = 1; i <= TOTAL_NUMEROS; i++) estados[i] = 'disponible';
    return estados;
  }
}

// ---------------------------------------------------------------------------
// Helpers de validación de formulario (mismo patrón visual que /registro)
// ---------------------------------------------------------------------------

/** Formatea un input de teléfono chileno mientras se escribe: "9 1234 5678". */
function formatearTelefonoInput(input: HTMLInputElement | null): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const digitos = input.value.replace(/\D/g, '').slice(0, 9);
    if (digitos.length > 5) {
      input.value = `${digitos.slice(0, 1)} ${digitos.slice(1, 5)} ${digitos.slice(5)}`;
    } else if (digitos.length > 1) {
      input.value = `${digitos.slice(0, 1)} ${digitos.slice(1)}`;
    } else {
      input.value = digitos;
    }
  });
}

/** Feedback en vivo bajo el campo de correo ("✓ Correo válido" / formato). */
function inicializarFeedbackEmail(input: HTMLInputElement | null, feedback: HTMLElement | null): void {
  if (!input || !feedback) return;
  const actualizar = () => {
    const valor = input.value.trim();
    feedback.classList.remove('valido', 'invalido');
    if (!valor) {
      feedback.textContent = '';
      return;
    }
    if (EMAIL_RE.test(valor)) {
      feedback.textContent = '✓ Correo válido';
      feedback.classList.add('valido');
    } else {
      feedback.textContent = 'Revisa el formato (ejemplo@correo.com)';
      feedback.classList.add('invalido');
    }
  };
  input.addEventListener('input', actualizar);
  input.addEventListener('blur', actualizar);
}

/** Agrega .tocado recién al salir de un campo — el estilo de error nunca
 * aparece antes de que la persona alcance a escribir algo. */
function inicializarEstadoTocado(form: HTMLFormElement): void {
  form.addEventListener(
    'blur',
    (evt) => {
      const el = evt.target as HTMLElement;
      if (el.matches?.('input')) el.classList.add('tocado');
    },
    true,
  );
}

/** Marca .con-contenido en cualquier campo que ya tenga algo escrito. */
function inicializarEstadoConContenido(form: HTMLFormElement): void {
  form.addEventListener('input', (evt) => {
    const el = evt.target as HTMLInputElement;
    if (!el.matches?.('input')) return;
    el.classList.toggle('con-contenido', el.value.trim().length > 0);
  });
}

export async function iniciarSorteo(): Promise<void> {
  const raiz = $('#sorteo-jugar');
  if (!raiz) return;

  const tickerNum = $<HTMLElement>('#rifaTickerNum');
  const tickerFill = $<HTMLElement>('#rifaTickerFill');
  const chipsWrap = $<HTMLElement>('#rifaChips');
  const chipsLista = $<HTMLElement>('#rifaChipsLista');
  const modoAzarBtn = $<HTMLButtonElement>('#rifaModoAzar');
  const modoElegirBtn = $<HTMLButtonElement>('#rifaModoElegir');
  const panelAzar = $<HTMLElement>('#rifaPanelAzar');
  const panelElegir = $<HTMLElement>('#rifaPanelElegir');
  const rollStage = $<HTMLElement>('#rifaRollStage');
  const buscarInput = $<HTMLInputElement>('#rifaBuscar');
  const soloDisponibles = $<HTMLInputElement>('#rifaSoloDisponibles');
  const bloquesCont = $<HTMLElement>('#rifaBloques');
  const grid = $<HTMLElement>('#rifaGrid');
  const upsellBox = $<HTMLElement>('#rifaUpsell');
  const upsellTexto = $<HTMLElement>('#rifaUpsellTexto');
  const upsellBtnPrincipal = $<HTMLButtonElement>('#rifaUpsellBtnPrincipal');
  const upsellBtnSecundario = $<HTMLButtonElement>('#rifaUpsellBtnSecundario');
  const cart = $<HTMLElement>('#rifaCart');
  const cartNums = $<HTMLElement>('#rifaCartNums');
  const cartTotal = $<HTMLElement>('#rifaCartTotal');
  const toast = $<HTMLElement>('#rifaToast');

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function mostrarToast(msg: string): void {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('activo');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('activo'), 3200);
  }

  // Código de referido (?ref=FH-XXXXXX) para atribuir la venta a un atleta.
  const rifaCodigoRef = new URLSearchParams(window.location.search).get('ref');
  if (rifaCodigoRef) {
    $<HTMLElement>('#rifaReferidoBanner')?.removeAttribute('hidden');
  }

  const estados = await cargarEstadosReales(mostrarToast);
  let carrito: number[] = [];
  let bloqueActivo = 1;
  let modoActivo: 'azar' | 'elegir' = 'azar';

  function contarVendidos(): number {
    return Object.values(estados).filter((e) => e === 'vendido').length;
  }

  const UMBRAL_CONTADOR = 30;
  const tickerInicio = $<HTMLElement>('#rifaTickerInicio');
  const tickerNormal = $<HTMLElement>('#rifaTickerNormal');

  function actualizarTicker(): void {
    const vendidos = contarVendidos();
    if (vendidos < UMBRAL_CONTADOR) {
      tickerInicio?.removeAttribute('hidden');
      tickerNormal?.setAttribute('hidden', '');
      return;
    }
    tickerInicio?.setAttribute('hidden', '');
    tickerNormal?.removeAttribute('hidden');
    if (tickerNum) tickerNum.textContent = String(vendidos);
    if (tickerFill) tickerFill.style.width = `${(vendidos / TOTAL_NUMEROS) * 100}%`;
  }

  function disponibles(): number[] {
    return Object.keys(estados)
      .map(Number)
      .filter((n) => estados[n] === 'disponible');
  }

  // ---- chip reutilizable: se usa tanto en la lista de arriba como en el carrito fijo ----
  function crearChip(n: number): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rifa-chip';
    chip.append(`#${String(n).padStart(3, '0')} `);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.setAttribute('aria-label', `Quitar ticket ${n}`);
    btn.addEventListener('click', () => quitarNumero(n));
    chip.appendChild(btn);
    return chip;
  }

  function renderChips(): void {
    if (!chipsWrap || !chipsLista) return;
    chipsLista.innerHTML = '';
    if (carrito.length === 0) {
      chipsWrap.hidden = true;
      return;
    }
    chipsWrap.hidden = false;
    [...carrito].sort((a, b) => a - b).forEach((n) => chipsLista.appendChild(crearChip(n)));
  }

  function quitarNumero(n: number): void {
    carrito = carrito.filter((x) => x !== n);
    if (estados[n] === 'seleccionado') estados[n] = 'disponible';
    renderGrid();
    renderChips();
    actualizarCarrito();
    actualizarUpsell();
  }

  // ---- grid de selección manual ----
  function construirBloques(): void {
    if (!bloquesCont) return;
    for (let b = 0; b < 8; b++) {
      const inicio = b * 100 + 1;
      const fin = b * 100 + 100;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rifa-bloque' + (b === 0 ? ' activo' : '');
      btn.textContent = `${inicio}–${fin}`;
      btn.dataset.bloque = String(b + 1);
      btn.addEventListener('click', () => {
        bloqueActivo = b + 1;
        $all('.rifa-bloque').forEach((x) => x.classList.remove('activo'));
        btn.classList.add('activo');
        renderGrid();
      });
      bloquesCont.appendChild(btn);
    }
  }

  function renderGrid(): void {
    if (!grid || !soloDisponibles) return;
    grid.innerHTML = '';
    const inicio = (bloqueActivo - 1) * 100 + 1;
    const fin = bloqueActivo * 100;

    for (let n = inicio; n <= fin; n++) {
      const estado = estados[n];
      if (soloDisponibles.checked && estado !== 'disponible' && estado !== 'seleccionado') continue;
      const celda = document.createElement('div');
      celda.className = 'rifa-num ' + (estado === 'seleccionado' ? 'seleccionado' : estado);
      celda.dataset.num = String(n);
      celda.textContent = String(n).padStart(3, '0');
      if (estado === 'disponible' || estado === 'seleccionado') {
        celda.addEventListener('click', () => toggleSeleccion(n));
      }
      grid.appendChild(celda);
    }
  }

  function toggleSeleccion(n: number): void {
    if (carrito.includes(n)) {
      quitarNumero(n);
      return;
    }
    estados[n] = 'seleccionado';
    carrito.push(n);
    renderGrid();
    renderChips();
    actualizarCarrito();
    actualizarUpsell();
  }

  function buscarNumero(valor: string): void {
    const n = parseInt(valor, 10);
    if (!n || n < 1 || n > TOTAL_NUMEROS) return;
    const bloque = Math.ceil(n / 100);
    if (bloque !== bloqueActivo) {
      bloqueActivo = bloque;
      $all('.rifa-bloque').forEach((x) => {
        x.classList.toggle('activo', Number((x as HTMLElement).dataset.bloque) === bloque);
      });
      renderGrid();
    }
    setTimeout(() => {
      const celda = $<HTMLElement>(`.rifa-num[data-num="${n}"]`);
      if (!celda) return;
      celda.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      celda.classList.add('resaltado');
      setTimeout(() => celda.classList.remove('resaltado'), 1500);
    }, 50);
  }

  const MAX_NUMEROS_POR_COMPRA = 20;

  // ---- agregar tickets al azar, con animación de ruleta ----
  function agregarNumeros(cantidad: number, conAnimacion: boolean): void {
    if (carrito.length + cantidad > MAX_NUMEROS_POR_COMPRA) {
      mostrarToast(`Máximo ${MAX_NUMEROS_POR_COMPRA} tickets por compra`);
      return;
    }
    const libres = disponibles();
    if (libres.length < cantidad) {
      mostrarToast('No quedan suficientes tickets disponibles');
      return;
    }
    const elegidos: number[] = [];
    while (elegidos.length < cantidad) {
      const n = libres[Math.floor(Math.random() * libres.length)];
      if (!elegidos.includes(n)) elegidos.push(n);
    }

    if (conAnimacion && !reduceMotion() && rollStage) {
      rollStage.innerHTML = '';
      rollStage.classList.add('activo');
      const slots = elegidos.map(() => {
        const div = document.createElement('div');
        div.className = 'rifa-roll-num';
        div.textContent = '000';
        rollStage.appendChild(div);
        return div;
      });
      let vueltas = 0;
      const roll = setInterval(() => {
        slots.forEach((s) => (s.textContent = String(Math.floor(Math.random() * TOTAL_NUMEROS) + 1).padStart(3, '0')));
        vueltas++;
        if (vueltas > 14) {
          clearInterval(roll);
          slots.forEach((s, i) => (s.textContent = String(elegidos[i]).padStart(3, '0')));
          confirmarSeleccion(elegidos);
        }
      }, 80);
    } else {
      confirmarSeleccion(elegidos);
    }
  }

  function confirmarSeleccion(elegidos: number[]): void {
    elegidos.forEach((n) => {
      estados[n] = 'seleccionado';
      carrito.push(n);
    });
    renderChips();
    actualizarCarrito();
    actualizarUpsell();
    if (modoActivo === 'elegir') renderGrid();
  }

  // ---- upsell dinámico: impar → completar el par · par → ofrecer 2 más ----
  function actualizarUpsell(): void {
    if (!upsellBox || !upsellTexto || !upsellBtnPrincipal || !upsellBtnSecundario) return;
    const n = carrito.length;
    if (n === 0) {
      upsellBox.classList.remove('activo');
      return;
    }
    if (n % 2 === 1) {
      const ultimo = carrito[carrito.length - 1];
      upsellTexto.innerHTML = `Ya tienes el ticket <strong>#${String(ultimo).padStart(3, '0')}</strong> 🔥 ¿Duplicamos la suerte? Agrega otro por solo <strong>$2.000 más</strong>.`;
      upsellBtnPrincipal.textContent = '🎲 Agrégame uno al azar';
      upsellBtnPrincipal.onclick = () => agregarNumeros(1, true);
      upsellBtnSecundario.textContent = `Continuar con ${n}`;
    } else {
      upsellTexto.innerHTML = `¡Llevas <strong>${n} tickets</strong> 🔥! ¿Agregamos 2 más?`;
      upsellBtnPrincipal.textContent = '🎲 Agregar 2 más al azar';
      upsellBtnPrincipal.onclick = () => agregarNumeros(2, true);
      upsellBtnSecundario.textContent = 'Ya tengo suficientes';
    }
    upsellBtnSecundario.onclick = () => upsellBox.classList.remove('activo');
    upsellBox.classList.add('activo');
  }

  // ---- carrito / precio (solo referencial: el monto real lo calcula el backend) ----
  function actualizarCarrito(): void {
    if (!cart || !cartNums || !cartTotal) return;
    if (carrito.length === 0) {
      cart.classList.remove('activo');
      return;
    }
    cart.classList.add('activo');
    const pares = Math.floor(carrito.length / 2);
    const resto = carrito.length % 2;
    const precio = pares * 5000 + resto * 3000;
    cartNums.innerHTML = '';
    [...carrito].sort((a, b) => a - b).forEach((n) => cartNums.appendChild(crearChip(n)));
    cartTotal.textContent = `$${precio.toLocaleString('es-CL')}`;
  }

  // ---------------------------------------------------------------------
  // Datos del comprador + conexión real con /api/sorteo/reservar y Flow
  // ---------------------------------------------------------------------
  const modalDatos = $<HTMLElement>('#rifaModalDatos');
  const modalFondo = $<HTMLElement>('#rifaModalFondo');
  const modalCerrar = $<HTMLButtonElement>('#rifaModalCerrar');
  const formDatos = $<HTMLFormElement>('#rifaFormDatos');
  const formError = $<HTMLElement>('#rifaFormError');
  const inputNombre = $<HTMLInputElement>('#rifaNombre');
  const inputEmail = $<HTMLInputElement>('#rifaEmail');
  const inputTelefono = $<HTMLInputElement>('#rifaTelefono');
  const inputInstagram = $<HTMLInputElement>('#rifaInstagram');
  const inputRut = $<HTMLInputElement>('#rifaRut');
  const emailFeedback = $<HTMLElement>('#rifaEmailFeedback');
  const botonEnviar = $<HTMLButtonElement>('#rifaModalEnviar');
  const toggleOpcionales = $<HTMLButtonElement>('#rifaToggleOpcionales');
  const camposOpcionales = $<HTMLElement>('#rifaCamposOpcionales');

  toggleOpcionales?.addEventListener('click', () => {
    const abierto = !camposOpcionales?.hidden;
    if (camposOpcionales) camposOpcionales.hidden = abierto;
    toggleOpcionales.setAttribute('aria-expanded', String(!abierto));
    toggleOpcionales.textContent = abierto ? '+ Agregar Instagram o RUT (opcional)' : '− Ocultar campos opcionales';
  });

  function abrirModalDatos(): void {
    if (carrito.length === 0) return;
    modalDatos?.removeAttribute('hidden');
    inputNombre?.focus();
  }

  function cerrarModalDatos(): void {
    modalDatos?.setAttribute('hidden', '');
    if (formError) formError.hidden = true;
  }

  function pagar(): void {
    abrirModalDatos();
  }

  function telefonoValido(valor: string): boolean {
    return valor.replace(/\D/g, '').length >= 8;
  }

  async function confirmarPago(): Promise<void> {
    const nombre = inputNombre?.value.trim() ?? '';
    const email = inputEmail?.value.trim() ?? '';
    const telefono = inputTelefono?.value.trim() ?? '';

    const valido = Boolean(nombre) && EMAIL_RE.test(email) && telefonoValido(telefono);
    if (!valido) {
      [inputNombre, inputEmail, inputTelefono].forEach((el) => el?.classList.add('tocado'));
      if (formError) formError.hidden = false;
      return;
    }
    if (formError) formError.hidden = true;

    if (botonEnviar) {
      botonEnviar.disabled = true;
      botonEnviar.textContent = 'Conectando con Flow…';
    }

    try {
      const res = await fetch('/api/sorteo/reservar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          numeros: carrito,
          rifaCodigo: rifaCodigoRef,
          comprador: {
            nombre,
            email,
            telefono,
            instagram: inputInstagram?.value.trim() ?? '',
            rut: inputRut?.value.trim() ?? '',
          },
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.numeros) {
        const perdidos: number[] = data.numeros;
        perdidos.forEach((n) => {
          carrito = carrito.filter((x) => x !== n);
          estados[n] = 'vendido';
        });
        renderGrid();
        renderChips();
        actualizarCarrito();
        actualizarUpsell();
        mostrarToast(`😬 Alguien se adelantó con ${perdidos.map((n) => '#' + String(n).padStart(3, '0')).join(', ')} — elige otro ticket`);
        cerrarModalDatos();
        return;
      }

      if (!res.ok || !data.url) {
        mostrarToast('No pudimos conectar con Flow. Intenta de nuevo en un momento.');
        return;
      }

      // Redirige el navegador al checkout real de Flow.
      window.location.href = data.url;
    } catch {
      mostrarToast('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    } finally {
      if (botonEnviar) {
        botonEnviar.disabled = false;
        botonEnviar.textContent = 'Continuar a pagar 🔥';
      }
    }
  }

  // ---- cambio de modo: limpia la selección para evitar mezclar azar + manual ----
  function limpiarSeleccion(avisar: boolean): void {
    if (carrito.length === 0) return;
    carrito.forEach((n) => {
      if (estados[n] === 'seleccionado') estados[n] = 'disponible';
    });
    carrito = [];
    renderGrid();
    renderChips();
    actualizarCarrito();
    actualizarUpsell();
    if (rollStage) {
      rollStage.classList.remove('activo');
      rollStage.innerHTML = '';
    }
    if (avisar) mostrarToast('🔄 Tu selección anterior se reinició');
  }

  function setModo(modo: 'azar' | 'elegir'): void {
    if (modo === modoActivo) return;
    limpiarSeleccion(true);
    modoActivo = modo;
    modoAzarBtn?.classList.toggle('activo', modo === 'azar');
    modoElegirBtn?.classList.toggle('activo', modo === 'elegir');
    panelAzar?.classList.toggle('activo', modo === 'azar');
    panelElegir?.classList.toggle('activo', modo === 'elegir');
    if (modo === 'elegir' && bloquesCont && !bloquesCont.childElementCount) {
      construirBloques();
      renderGrid();
    }
  }

  // ---- listeners ----
  modoAzarBtn?.addEventListener('click', () => setModo('azar'));
  modoElegirBtn?.addEventListener('click', () => setModo('elegir'));
  $all('[data-rifa-azar]').forEach((btn) => {
    const cantidad = Number((btn as HTMLElement).dataset.rifaAzar);
    btn.addEventListener('click', () => agregarNumeros(cantidad, true));
  });
  buscarInput?.addEventListener('input', (e) => buscarNumero((e.target as HTMLInputElement).value));
  soloDisponibles?.addEventListener('change', renderGrid);
  $('#rifaCartPagar')?.addEventListener('click', pagar);

  modalFondo?.addEventListener('click', cerrarModalDatos);
  modalCerrar?.addEventListener('click', cerrarModalDatos);
  formDatos?.addEventListener('submit', (e) => {
    e.preventDefault();
    void confirmarPago();
  });

  formatearTelefonoInput(inputTelefono);
  inicializarFeedbackEmail(inputEmail, emailFeedback);
  if (formDatos) {
    inicializarEstadoTocado(formDatos);
    inicializarEstadoConContenido(formDatos);
  }

  actualizarTicker();
}
