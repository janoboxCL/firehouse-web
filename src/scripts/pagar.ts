// Página /pagar: cuenta personal de la familia (link con token secreto).
// Paso 1: la familia confirma sus datos (una vez). Paso 2: elige qué pagar.

import { faltantesFicha, validarFicha, type Ficha } from '../lib/crm/ficha.ts';

interface Pendiente {
  id: string;
  deportista: string | null;
  concepto: string;
  descripcion: string;
  saldo: number;
  vencimiento: string | null;
  sugerido: boolean;
  obligatorio: boolean;
}

interface Historial {
  numero: string;
  fecha: string;
  total: number;
  medio: string;
  lineas: Array<{ descripcion?: string; deportista?: string | null; monto: number }>;
}

interface Cuenta {
  familia: string;
  pendientes: Pendiente[];
  historial: Historial[];
  /** null si el servidor aún no tiene el paso de confirmación (migración 0019). */
  ficha?: Ficha | null;
  tallas?: string[];
}

export const CLAVE_TOKEN = 'fh-cuenta-token';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date(iso));
const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const MEDIO: Record<string, string> = { MERCADOPAGO: 'Mercado Pago', FLOW: 'Flow', EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia' };

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

function renderPendientes(c: Cuenta): void {
  const cont = $<HTMLElement>('#pg-pendientes');
  const alDia = c.pendientes.length === 0;
  $<HTMLElement>('#pg-al-dia').hidden = !alDia;
  $<HTMLElement>('#pg-pie').hidden = alDia;
  const grupos = new Map<string, Pendiente[]>();
  c.pendientes.forEach((p) => {
    const k = p.deportista ?? 'Familia';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  });
  const h = hoy();
  cont.innerHTML = [...grupos.entries()]
    .map(
      ([nombre, items]) => `
      <p class="pg-deportista">${esc(nombre)}</p>
      ${items
        .map((p) => {
          const vencida = !!p.vencimiento && p.vencimiento < h;
          const meta = p.obligatorio
            ? '<span class="pg-item__meta pg-item__meta--vencida">Vencida: debe incluirse en este pago</span>'
            : vencida
              ? `<span class="pg-item__meta pg-item__meta--vencida">Venció el ${fechaCorta(p.vencimiento!)}</span>`
              : p.vencimiento
                ? `<span class="pg-item__meta">Vence el ${fechaCorta(p.vencimiento)}</span>`
                : '';
          return `<label class="pg-item">
            <input type="checkbox" value="${esc(p.id)}" data-monto="${p.saldo}" ${p.sugerido || p.obligatorio ? 'checked' : ''} ${
              p.obligatorio ? 'disabled data-obligatorio="1"' : ''
            } />
            <span class="pg-item__texto">${esc(p.descripcion)}${meta}</span>
            <span class="pg-item__monto">${pesos(p.saldo)}</span>
          </label>`;
        })
        .join('')}`,
    )
    .join('');
  actualizarTotal();
}

function seleccionados(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('#pg-pendientes input[type=checkbox]')].filter((i) => i.checked);
}

function actualizarTotal(): void {
  const total = seleccionados().reduce((s, i) => s + Number(i.dataset.monto), 0);
  $<HTMLElement>('#pg-total').textContent = pesos(total);
  const boton = $<HTMLButtonElement>('#pg-pagar');
  boton.disabled = total === 0;
  boton.textContent = total ? `Pagar ${pesos(total)} con Mercado Pago` : 'Selecciona qué pagar';
}

function renderHistorial(c: Cuenta): void {
  $<HTMLElement>('#pg-historial-wrap').hidden = c.historial.length === 0;
  $<HTMLElement>('#pg-historial').innerHTML = c.historial
    .map(
      (p) => `<li><strong>${fechaLarga(p.fecha)} · ${pesos(p.total)}</strong> · ${esc(MEDIO[p.medio] ?? p.medio)}<br/>${p.lineas
        .map((l) => `${l.deportista ? `${esc(l.deportista)}: ` : ''}${esc(l.descripcion ?? '')}`)
        .join('<br/>')}</li>`,
    )
    .join('');
}

function conectarRecuperar(): void {
  const form = $<HTMLFormElement>('#pg-recuperar');
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $<HTMLElement>('#pg-recuperar-msg');
    const boton = form.querySelector<HTMLButtonElement>('button')!;
    boton.disabled = true;
    try {
      const r = await fetch('/api/pagar/recuperar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: $<HTMLInputElement>('#pg-email').value, sitio: $<HTMLInputElement>('#pg-sitio').value }),
      });
      const d = (await r.json().catch(() => ({}))) as { mensaje?: string };
      msg.textContent = d.mensaje ?? 'Si el correo está registrado, te enviamos el link en unos minutos.';
    } catch {
      msg.textContent = 'No pudimos enviar la solicitud. Inténtalo nuevamente.';
    } finally {
      msg.hidden = false;
      boton.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Paso 1: confirmar los datos de la familia

function campoAtleta(a: Ficha['atletas'][number], i: number, total: number, tallas: string[]): string {
  const opciones = a.talla && !tallas.includes(a.talla) ? [...tallas, a.talla] : tallas;
  const id = esc(a.id);
  return `
    <fieldset class="pg-card pg-ficha__bloque" data-atleta="${id}">
      <legend class="pg-legend">${total > 1 ? `Deportista ${i + 1}` : 'Deportista'}</legend>
      <div class="pg-campos">
        <div class="pg-campo">
          <label class="pg-label" for="pg-at-nombre-${id}">Nombre</label>
          <input id="pg-at-nombre-${id}" class="pg-in" type="text" data-campo="nombre" maxlength="80" value="${esc(a.nombre)}" />
          <p class="pg-campo-error" data-error="atleta-${id}-nombre" hidden></p>
        </div>
        <div class="pg-campo">
          <label class="pg-label" for="pg-at-apellidos-${id}">Apellidos</label>
          <input id="pg-at-apellidos-${id}" class="pg-in" type="text" data-campo="apellidos" maxlength="120" value="${esc(a.apellidos)}" />
          <p class="pg-campo-error" data-error="atleta-${id}-apellidos" hidden></p>
        </div>
        <div class="pg-campo">
          <label class="pg-label" for="pg-at-fecha-${id}">Fecha de nacimiento</label>
          <input id="pg-at-fecha-${id}" class="pg-in" type="date" data-campo="fechaNacimiento" max="${hoy()}" min="1940-01-01" value="${esc(a.fechaNacimiento)}" />
          ${a.edadDeclarada !== null ? `<p class="pg-pista">En la clase anotamos solo su edad (${a.edadDeclarada} años). Indícanos la fecha exacta.</p>` : ''}
          <p class="pg-campo-error" data-error="atleta-${id}-fecha" hidden></p>
        </div>
        <div class="pg-campo">
          <label class="pg-label" for="pg-at-talla-${id}">Talla de polera</label>
          <select id="pg-at-talla-${id}" class="pg-in" data-campo="talla">
            <option value="">Aún no la sé</option>
            ${opciones.map((t) => `<option value="${esc(t)}" ${t === a.talla ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
          <p class="pg-campo-error" data-error="atleta-${id}-talla" hidden></p>
        </div>
      </div>
    </fieldset>`;
}

function leerFichaFormulario(): Record<string, unknown> {
  const v = (s: string) => $<HTMLInputElement | HTMLSelectElement>(s).value;
  const comuna = v('#pg-ap-comuna') === 'OTRA' ? v('#pg-ap-comuna-otra') : v('#pg-ap-comuna');
  return {
    apoderado: { nombre: v('#pg-ap-nombre'), apellidos: v('#pg-ap-apellidos'), telefono: v('#pg-ap-telefono'), email: v('#pg-ap-email'), comuna, relacion: v('#pg-ap-relacion') },
    atletas: [...document.querySelectorAll<HTMLElement>('#pg-ficha-atletas [data-atleta]')].map((f) => {
      const campo = (c: string) => f.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-campo="${c}"]`)!.value;
      return { id: f.dataset.atleta, nombre: campo('nombre'), apellidos: campo('apellidos'), fechaNacimiento: campo('fechaNacimiento'), talla: campo('talla') };
    }),
    aceptaCondiciones: $<HTMLInputElement>('#pg-acepta').checked,
  };
}

/** Muestra los errores por campo y lleva al primero. */
function mostrarErroresFicha(errores: Record<string, string>): void {
  const form = $<HTMLFormElement>('#pg-ficha');
  form.querySelectorAll<HTMLElement>('[data-error]').forEach((p) => {
    const texto = errores[p.dataset.error!];
    p.textContent = texto ?? '';
    p.hidden = !texto;
    p.parentElement?.querySelectorAll('.pg-in').forEach((i) => i.setAttribute('aria-invalid', String(!!texto)));
  });
  const primero = form.querySelector<HTMLElement>('[data-error]:not([hidden])');
  if (primero) {
    const campo = primero.parentElement?.querySelector<HTMLElement>('.pg-in:not([hidden]), input');
    (campo ?? primero).scrollIntoView({ block: 'center' });
    campo?.focus({ preventScroll: true });
  }
}

function llenarFicha(ficha: Ficha, tallas: string[]): void {
  const set = (s: string, valor: string) => {
    const el = $<HTMLInputElement | HTMLSelectElement>(s);
    el.value = valor;
    // Lo que falta completar se destaca.
    el.classList.toggle('pg-in--falta', !valor);
  };
  set('#pg-ap-nombre', ficha.apoderado.nombre);
  set('#pg-ap-apellidos', ficha.apoderado.apellidos);
  set('#pg-ap-telefono', ficha.apoderado.telefono);
  set('#pg-ap-email', ficha.apoderado.email);
  $<HTMLSelectElement>('#pg-ap-relacion').value = ficha.apoderado.relacion || 'MAMA';
  const comuna = $<HTMLSelectElement>('#pg-ap-comuna');
  const otra = $<HTMLInputElement>('#pg-ap-comuna-otra');
  const enLista = [...comuna.options].some((o) => o.value === ficha.apoderado.comuna && o.value !== 'OTRA');
  comuna.value = ficha.apoderado.comuna ? (enLista ? ficha.apoderado.comuna : 'OTRA') : '';
  comuna.classList.toggle('pg-in--falta', !ficha.apoderado.comuna);
  otra.value = enLista ? '' : ficha.apoderado.comuna;
  otra.hidden = comuna.value !== 'OTRA';
  $<HTMLElement>('#pg-ficha-atletas').innerHTML = ficha.atletas.map((a, i) => campoAtleta(a, i, ficha.atletas.length, tallas)).join('');
  document.querySelectorAll<HTMLInputElement>('#pg-ficha-atletas input').forEach((i) => i.classList.toggle('pg-in--falta', !i.value));
  $<HTMLInputElement>('#pg-acepta').checked = false;

  const falta = faltantesFicha(ficha);
  $<HTMLElement>('#pg-ficha-intro').textContent = ficha.confirmada
    ? 'Estos son los datos que tenemos de tu familia. Corrige lo que haya cambiado.'
    : falta.length
      ? `Antes de pagar, revisa tus datos y completa lo que falta (${falta.join(', ')}). Solo te lo pedimos una vez.`
      : 'Antes de pagar, revisa que tus datos estén correctos. Solo te lo pedimos una vez.';
}

/** Muestra el paso que corresponde. `editar`: la familia ya confirmó y quiere revisar sus datos. */
function mostrarPaso(paso: 1 | 2, editar = false): void {
  $<HTMLElement>('#pg-ficha').hidden = paso !== 1;
  $<HTMLElement>('#pg-pago').hidden = paso !== 2;
  $<HTMLElement>('#pg-pasos').hidden = false;
  const p1 = $<HTMLElement>('#pg-paso-1');
  const p2 = $<HTMLElement>('#pg-paso-2');
  p1.classList.toggle('pg-paso--listo', paso === 2);
  if (paso === 1) {
    p1.setAttribute('aria-current', 'step');
    p2.removeAttribute('aria-current');
  } else {
    p2.setAttribute('aria-current', 'step');
    p1.removeAttribute('aria-current');
  }
  $<HTMLElement>('#pg-ficha-cancelar').hidden = !editar;
  $<HTMLElement>('#pg-ficha-guardar').textContent = editar ? 'Guardar mis datos' : 'Confirmar y continuar al pago';
  $<HTMLElement>('#pg-datos-ok').hidden = paso !== 2;
}

function conectarFicha(token: string, cuenta: Cuenta, alConfirmar: () => Promise<void>): void {
  const ficha = cuenta.ficha!;
  const tallas = cuenta.tallas ?? [];
  const form = $<HTMLFormElement>('#pg-ficha');
  const comuna = $<HTMLSelectElement>('#pg-ap-comuna');
  comuna.addEventListener('change', () => {
    const otra = $<HTMLInputElement>('#pg-ap-comuna-otra');
    otra.hidden = comuna.value !== 'OTRA';
    if (!otra.hidden) otra.focus();
  });
  form.addEventListener('input', (e) => (e.target as HTMLElement).classList?.remove('pg-in--falta'));
  $('#pg-ficha-editar').addEventListener('click', () => {
    llenarFicha(cuenta.ficha!, tallas);
    mostrarErroresFicha({});
    mostrarPaso(1, true);
    $<HTMLElement>('#pg-pasos').scrollIntoView({ block: 'start' });
  });
  $('#pg-ficha-cancelar').addEventListener('click', () => mostrarPaso(2));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $<HTMLElement>('#pg-ficha-error');
    const boton = $<HTMLButtonElement>('#pg-ficha-guardar');
    error.hidden = true;
    const cuerpo = leerFichaFormulario();
    const v = validarFicha(cuerpo, cuenta.ficha!.atletas.map((a) => a.id), hoy());
    if (!v.ok) {
      mostrarErroresFicha(v.errores);
      return;
    }
    mostrarErroresFicha({});
    const texto = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/pagar/ficha', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: token, ...cuerpo }) });
      const d = (await r.json().catch(() => ({}))) as { mensaje?: string; errores?: Record<string, string> };
      if (r.status === 400 && d.errores) {
        mostrarErroresFicha(d.errores);
        return;
      }
      if (!r.ok) throw new Error(d.mensaje ?? 'No pudimos guardar tus datos. Inténtalo nuevamente.');
      await alConfirmar();
      mostrarPaso(2);
      $<HTMLElement>('#pg-pasos').scrollIntoView({ block: 'start' });
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'No pudimos guardar tus datos.';
      error.hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  });

  llenarFicha(ficha, tallas);
  mostrarPaso(ficha.confirmada ? 2 : 1);
}

export async function iniciarPagar(): Promise<void> {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const cargando = $<HTMLElement>('#pg-cargando');
  conectarRecuperar();

  if (!token) {
    cargando.hidden = true;
    return; // sin link: solo se muestra el formulario para recibirlo por correo
  }

  const leerCuenta = async (): Promise<Cuenta> => {
    const r = await fetch(`/api/pagar/estado?t=${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as Cuenta;
  };
  let cuenta: Cuenta;
  try {
    cuenta = await leerCuenta();
  } catch {
    cargando.hidden = true;
    $<HTMLElement>('#pg-sin-link').hidden = false;
    return;
  }

  try {
    sessionStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    /* sin almacenamiento */
  }
  cargando.hidden = true;
  $<HTMLElement>('#pg-familia').textContent = cuenta.familia || 'familia Firehouse';
  $<HTMLElement>('#pg-cuenta').hidden = false;
  $<HTMLFormElement>('#pg-recuperar').hidden = true;
  renderPendientes(cuenta);
  renderHistorial(cuenta);
  if (cuenta.ficha && cuenta.ficha.atletas.length > 0) {
    // Tras confirmar se vuelve a leer la cuenta: nombres y datos ya actualizados.
    conectarFicha(token, cuenta, async () => {
      const nueva = await leerCuenta();
      Object.assign(cuenta, nueva);
      $<HTMLElement>('#pg-familia').textContent = cuenta.familia || 'familia Firehouse';
      renderPendientes(cuenta);
      renderHistorial(cuenta);
    });
  }

  $<HTMLElement>('#pg-pendientes').addEventListener('change', actualizarTotal);
  $<HTMLFormElement>('#pg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $<HTMLElement>('#pg-error');
    const boton = $<HTMLButtonElement>('#pg-pagar');
    error.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Conectando con Mercado Pago…';
    try {
      const r = await fetch('/api/pagar/crear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token, cargos: seleccionados().map((i) => i.value) }),
      });
      const d = (await r.json().catch(() => ({}))) as { url?: string; mensaje?: string };
      if (!r.ok || !d.url) throw new Error(d.mensaje ?? 'No pudimos iniciar el pago. Inténtalo nuevamente.');
      location.href = d.url;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'No pudimos iniciar el pago.';
      error.hidden = false;
      actualizarTotal();
    }
  });
}
