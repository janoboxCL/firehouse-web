// Formulario corto de Firehouse Star. A diferencia de /registro (3 pasos,
// para triage entre varios journeys), acá el journey ya se sabe de
// antemano — este script valida, arma el arreglo de niñas/niños, llama a
// crear-orden y redirige al checkout de la pasarela. Mismo patrón de
// fetch/redirect que src/scripts/campana2026.ts, y misma idea de tarjetas
// dinámicas de atleta que src/scripts/registro-form.ts (simplificada: acá
// solo se piden nombre, apellidos y fecha de nacimiento).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTO_KIT = 10000;
const MAX_ATLETAS = 5;

let contadorAtletas = 0;

function $<T extends Element>(sel: string, contexto: ParentNode = document): T | null {
  return contexto.querySelector<T>(sel);
}
function $all<T extends Element>(sel: string, contexto: ParentNode = document): T[] {
  return Array.from(contexto.querySelectorAll<T>(sel));
}

function plantillaAtleta(numero: number): string {
  return `
    <fieldset class="rstar-atleta-card" data-atleta-card>
      <div class="rstar-atleta-card__cabecera">
        <p class="rstar-atleta-card__titulo">Niña o niño ${numero}</p>
        <button type="button" class="rstar-atleta-card__eliminar" data-accion="eliminar-atleta" hidden>Eliminar</button>
      </div>
      <div class="rstar-fila">
        <div class="rstar-campo">
          <label>Nombre</label>
          <input type="text" data-campo="nombre" required maxlength="80" />
        </div>
        <div class="rstar-campo">
          <label>Apellidos <span class="rstar-opcional">(opcional)</span></label>
          <input type="text" data-campo="apellidos" maxlength="120" />
        </div>
      </div>
      <div class="rstar-campo">
        <label>Fecha de nacimiento</label>
        <input type="date" data-campo="fechaNacimiento" required />
      </div>
    </fieldset>
  `.trim();
}

function crearElementoDesdeHTML(html: string): HTMLElement {
  const contenedor = document.createElement('div');
  contenedor.innerHTML = html;
  return contenedor.firstElementChild as HTMLElement;
}

function actualizarTotal(): void {
  const cantidad = $all('[data-atleta-card]').length;
  const total = $<HTMLElement>('#rstar-total');
  if (total) total.textContent = `$${(MONTO_KIT * cantidad).toLocaleString('es-CL')}`;
}

function renumerarAtletas(): void {
  const cards = $all<HTMLElement>('[data-atleta-card]');
  cards.forEach((card, i) => {
    const numero = i + 1;
    const titulo = $('.rstar-atleta-card__titulo', card);
    if (titulo) titulo.textContent = `Niña o niño ${numero}`;
    const btnEliminar = $<HTMLButtonElement>('[data-accion="eliminar-atleta"]', card);
    if (btnEliminar) btnEliminar.hidden = cards.length <= 1;
  });
  const btnAgregar = $<HTMLButtonElement>('#rstar-agregar-atleta');
  if (btnAgregar) btnAgregar.hidden = cards.length >= MAX_ATLETAS;
  actualizarTotal();
}

function inicializarTarjetaAtleta(card: HTMLElement): void {
  const fecha = $<HTMLInputElement>('[data-campo="fechaNacimiento"]', card);
  if (fecha) fecha.max = new Date().toISOString().slice(0, 10);

  const btnEliminar = $<HTMLButtonElement>('[data-accion="eliminar-atleta"]', card);
  btnEliminar?.addEventListener('click', () => {
    if ($all('[data-atleta-card]').length <= 1) return; // siempre debe quedar al menos una niña o niño
    card.remove();
    renumerarAtletas();
  });
}

function agregarAtleta(): void {
  const lista = $('#rstar-atletas-lista');
  if (!lista) return;
  contadorAtletas += 1;
  const card = crearElementoDesdeHTML(plantillaAtleta(contadorAtletas));
  lista.appendChild(card);
  inicializarTarjetaAtleta(card);
  renumerarAtletas();
}

function inicializarComunaOtra(): void {
  const select = $<HTMLSelectElement>('#rstar-ap-comuna');
  const wrap = $<HTMLElement>('#rstar-comuna-otra-wrap');
  const input = $<HTMLInputElement>('#rstar-ap-comuna-otra');
  if (!select || !wrap || !input) return;

  select.addEventListener('change', () => {
    const esOtra = select.value === 'OTRA';
    wrap.hidden = !esOtra;
    if (esOtra) {
      input.setAttribute('required', 'required');
      input.focus();
    } else {
      input.removeAttribute('required');
      input.value = '';
    }
  });
}

function leerComunaSeleccionada(): string {
  const select = $<HTMLSelectElement>('#rstar-ap-comuna');
  if (!select) return '';
  if (select.value === 'OTRA') return $<HTMLInputElement>('#rstar-ap-comuna-otra')?.value.trim() ?? '';
  return select.value;
}

function leerAtletas(): { nombre: string; apellidos: string; fechaNacimiento: string }[] {
  return $all<HTMLElement>('[data-atleta-card]').map((card) => ({
    nombre: $<HTMLInputElement>('[data-campo="nombre"]', card)?.value.trim() ?? '',
    apellidos: $<HTMLInputElement>('[data-campo="apellidos"]', card)?.value.trim() ?? '',
    fechaNacimiento: $<HTMLInputElement>('[data-campo="fechaNacimiento"]', card)?.value.trim() ?? '',
  }));
}

export function iniciarFormularioStar(): void {
  const form = $<HTMLFormElement>('#rstar-form');
  const btn = $<HTMLButtonElement>('#rstar-enviar');
  const error = $<HTMLParagraphElement>('#rstar-error');
  const deshabilitadoAviso = $<HTMLDivElement>('#rstar-deshabilitado');
  if (!form || !btn) return;

  inicializarComunaOtra();
  agregarAtleta(); // arranca con una tarjeta ya lista
  $('#rstar-agregar-atleta')?.addEventListener('click', agregarAtleta);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error?.setAttribute('hidden', '');
    deshabilitadoAviso?.setAttribute('hidden', '');

    // Honeypot — igual que el resto de los formularios públicos del sitio.
    const trampa = $<HTMLInputElement>('#rstar-trampa');
    if (trampa && trampa.value.trim() !== '') return;

    const apNombre = $<HTMLInputElement>('#rstar-ap-nombre')?.value.trim() ?? '';
    const apApellidos = $<HTMLInputElement>('#rstar-ap-apellidos')?.value.trim() ?? '';
    const apTelefono = $<HTMLInputElement>('#rstar-ap-telefono')?.value.trim() ?? '';
    const apEmail = $<HTMLInputElement>('#rstar-ap-email')?.value.trim() ?? '';
    const apComuna = leerComunaSeleccionada();

    const atletas = leerAtletas();
    const aceptaCondiciones = $<HTMLInputElement>('#rstar-acepta')?.checked ?? false;
    const telefonoDigitos = apTelefono.replace(/\D/g, '');

    const mostrarError = (msg: string) => {
      if (error) {
        error.textContent = msg;
        error.removeAttribute('hidden');
      }
    };

    if (apNombre.length < 2 || apApellidos.length < 2) return mostrarError('Ingresa el nombre y apellido del apoderado.');
    if (!EMAIL_RE.test(apEmail)) return mostrarError('Ingresa un correo válido.');
    if (telefonoDigitos.length < 8) return mostrarError('Ingresa un WhatsApp válido.');
    if (!apComuna) return mostrarError('Ingresa la comuna.');
    if (atletas.length === 0) return mostrarError('Agrega al menos una niña o niño.');
    for (const a of atletas) {
      if (a.nombre.length < 2) return mostrarError('Ingresa el nombre de cada niña o niño.');
      if (!a.fechaNacimiento) return mostrarError('Ingresa la fecha de nacimiento de cada niña o niño.');
    }
    if (!aceptaCondiciones) return mostrarError('Debes aceptar las condiciones para continuar.');

    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.textContent = 'Procesando…';

    try {
      const res = await fetch('/api/registro-star/crear-orden', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apoderado: {
            nombre: apNombre,
            apellidos: apApellidos,
            telefono: telefonoDigitos.startsWith('56') ? `+${telefonoDigitos}` : `+56${telefonoDigitos}`,
            email: apEmail,
            comuna: apComuna,
          },
          atletas: atletas.map((a) => ({ nombre: a.nombre, apellidos: a.apellidos || apApellidos, fechaNacimiento: a.fechaNacimiento })),
          aceptaCondiciones: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.error === 'checkout_deshabilitado') {
        deshabilitadoAviso?.removeAttribute('hidden');
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
        return;
      }

      mostrarError('No pudimos procesar tu inscripción. Intenta de nuevo o escríbenos por WhatsApp.');
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    } catch {
      mostrarError('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  });
}
