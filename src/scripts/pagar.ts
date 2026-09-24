// Página /pagar: cuenta personal de la familia (link con token secreto).

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

export async function iniciarPagar(): Promise<void> {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const cargando = $<HTMLElement>('#pg-cargando');
  conectarRecuperar();

  if (!token) {
    cargando.hidden = true;
    return; // sin link: solo se muestra el formulario para recibirlo por correo
  }

  let cuenta: Cuenta;
  try {
    const r = await fetch(`/api/pagar/estado?t=${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error(String(r.status));
    cuenta = (await r.json()) as Cuenta;
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
