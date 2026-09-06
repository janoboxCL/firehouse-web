// Lógica interactiva de /rifa: selección de números (manual o al azar), upsell de
// pack de 2, chips de selección y resumen de compra.
//
// ⚠️ DATOS DE MUESTRA: el objeto `estados` de más abajo se genera al azar en el
// navegador solo para poder mostrar y probar la interfaz. No hay todavía backend
// real detrás (Supabase + Flow), así que:
//   - el estado de cada número NO es el real y se reinicia cada vez que alguien
//     carga la página;
//   - el botón "Pagar con Flow" solo muestra un aviso, no cobra nada.
// Cuando se conecte el backend, hay que reemplazar `generarEstadoDeMuestra()` por
// una carga real (fetch a /api/rifa/numeros o similar) y `pagar()` por la creación
// real de la orden en Flow, manteniendo el resto de la lógica (selección, upsell,
// carrito) igual.

const TOTAL_NUMEROS = 800;
const PRECIO_UNO = 3000;
const PRECIO_PACK = 5000;

type EstadoNumero = 'disponible' | 'reservado' | 'vendido' | 'seleccionado';

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}
function $all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ⚠️ Reemplazar por datos reales del backend cuando exista.
function generarEstadoDeMuestra(): Record<number, EstadoNumero> {
  const estados: Record<number, EstadoNumero> = {};
  for (let i = 1; i <= TOTAL_NUMEROS; i++) {
    const r = Math.random();
    estados[i] = r < 0.55 ? 'vendido' : r < 0.6 ? 'reservado' : 'disponible';
  }
  return estados;
}

export function iniciarRifa(): void {
  const raiz = $('#rifa-jugar');
  if (!raiz) return;

  const estados = generarEstadoDeMuestra();
  let carrito: number[] = [];
  let bloqueActivo = 1;
  let modoActivo: 'azar' | 'elegir' = 'azar';

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
    toastTimer = setTimeout(() => toast.classList.remove('activo'), 2600);
  }

  function contarVendidos(): number {
    return Object.values(estados).filter((e) => e === 'vendido').length;
  }

  function actualizarTicker(): void {
    const vendidos = contarVendidos();
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
    btn.setAttribute('aria-label', `Quitar número ${n}`);
    btn.addEventListener('click', () => quitarNumero(n));
    chip.appendChild(btn);
    return chip;
  }

  // ---- chips (números elegidos, siempre visibles sin importar el modo) ----
  function renderChips(): void {
    if (!chipsWrap || !chipsLista) return;
    chipsLista.innerHTML = '';
    if (carrito.length === 0) {
      chipsWrap.hidden = true;
      return;
    }
    chipsWrap.hidden = false;
    [...carrito]
      .sort((a, b) => a - b)
      .forEach((n) => chipsLista.appendChild(crearChip(n)));
  }

  function quitarNumero(n: number): void {
    carrito = carrito.filter((x) => x !== n);
    estados[n] = 'disponible';
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

  // ---- agregar números al azar, con animación de ruleta ----
  function agregarNumeros(cantidad: number, conAnimacion: boolean): void {
    const libres = disponibles();
    if (libres.length < cantidad) {
      mostrarToast('No quedan suficientes números disponibles');
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
      upsellTexto.innerHTML = `Ya tienes el <strong>#${String(ultimo).padStart(3, '0')}</strong> 🔥 ¿Duplicamos la suerte? Agrega otro por solo <strong>$2.000 más</strong>.`;
      upsellBtnPrincipal.textContent = '🎲 Agrégame uno al azar';
      upsellBtnPrincipal.onclick = () => agregarNumeros(1, true);
      upsellBtnSecundario.textContent = `Continuar con ${n}`;
    } else {
      upsellTexto.innerHTML = `¡Llevas <strong>${n} números</strong> 🔥! ¿Agregamos 2 más?`;
      upsellBtnPrincipal.textContent = '🎲 Agregar 2 más al azar';
      upsellBtnPrincipal.onclick = () => agregarNumeros(2, true);
      upsellBtnSecundario.textContent = 'Ya tengo suficientes';
    }
    upsellBtnSecundario.onclick = () => upsellBox.classList.remove('activo');
    upsellBox.classList.add('activo');
  }

  // ---- carrito / precio ----
  function actualizarCarrito(): void {
    if (!cart || !cartNums || !cartTotal) return;
    if (carrito.length === 0) {
      cart.classList.remove('activo');
      return;
    }
    cart.classList.add('activo');
    const pares = Math.floor(carrito.length / 2);
    const resto = carrito.length % 2;
    const precio = pares * PRECIO_PACK + resto * PRECIO_UNO;
    cartNums.innerHTML = '';
    [...carrito]
      .sort((a, b) => a - b)
      .forEach((n) => cartNums.appendChild(crearChip(n)));
    cartTotal.textContent = `$${precio.toLocaleString('es-CL')}`;
  }

  // ---- datos del comprador (puede ser distinto al atleta del código) ----
  interface DatosComprador {
    nombre: string;
    email: string;
    telefono: string;
    instagram: string;
    rut: string;
  }

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

  function confirmarPago(datos: DatosComprador): void {
    // ⚠️ Acá va la integración real: crear la venta + reservar números
    // (POST /api/rifa/reservar con `datos` y `carrito`), y si la reserva
    // funciona, redirigir a la URL que devuelve Flow. Por ahora solo simula.
    cerrarModalDatos();
    mostrarToast(`🔥 Vista previa — en el sitio real esto crea la orden en Flow para ${datos.nombre.split(' ')[0]}`);
  }

  // ---- cambio de modo: limpia la selección para evitar mezclar azar + manual ----
  function limpiarSeleccion(avisar: boolean): void {
    if (carrito.length === 0) return;
    carrito.forEach((n) => (estados[n] = 'disponible'));
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
    const nombre = inputNombre?.value.trim() ?? '';
    const email = inputEmail?.value.trim() ?? '';
    const telefono = inputTelefono?.value.trim() ?? '';

    if (!nombre || !email || !telefono) {
      if (formError) formError.hidden = false;
      return;
    }
    if (formError) formError.hidden = true;

    confirmarPago({
      nombre,
      email,
      telefono,
      instagram: inputInstagram?.value.trim() ?? '',
      rut: inputRut?.value.trim() ?? '',
    });
  });

  actualizarTicker();
}
