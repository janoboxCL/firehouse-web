// Sección "Estado de la campaña" de /admin/campana-2026: habilitar y
// deshabilitar compras y participación sin compra, con los requisitos visibles.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Chequeo, ConfigCampana, EstadoCampana } from '../lib/crm/campana-estado.ts';

interface RespuestaEstado {
  config: ConfigCampana;
  estado: EstadoCampana;
  chequeos: Chequeo[];
  inicioAdelantado: boolean;
  participacionesPrueba: number;
  oficiales: { inicio: string };
}

const ETIQUETA: Record<EstadoCampana, string> = {
  ABIERTA: 'Abierta',
  FUERA_DE_PERIODO: 'Habilitada, fuera de periodo',
  CERRADA: 'Cerrada',
  SORTEO_CERRADO: 'Sorteo cerrado',
};

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fecha(iso: string | null): string {
  if (!iso) return 'Sin definir';
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
}

let supabase: SupabaseClient;
let ultimo: RespuestaEstado | null = null;

async function llamar(metodo: 'GET' | 'POST', accion?: string): Promise<RespuestaEstado> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  const r = await fetch('/api/admin/campana-estado', {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify({ accion }) : undefined,
  });
  const cuerpo = (await r.json().catch(() => ({}))) as RespuestaEstado & { mensaje?: string };
  if (!r.ok) throw new Error(cuerpo.mensaje ?? `Error ${r.status}`);
  return cuerpo;
}

function descripcion(d: RespuestaEstado): string {
  const c = d.config;
  const activos = [c.checkout_habilitado ? 'compras' : null, c.participacion_habilitada ? 'participación sin compra' : null].filter(Boolean).join(' y ');
  if (d.estado === 'ABIERTA') return `En el sitio están abiertas: ${activos}.`;
  if (d.estado === 'SORTEO_CERRADO') return 'El sorteo ya se cerró. La campaña no se puede volver a abrir.';
  if (d.estado === 'CERRADA') return 'Nadie puede comprar ni participar en el sitio.';
  const ahora = Date.now();
  if (c.inicio_at && ahora < Date.parse(c.inicio_at)) return `Habilitadas (${activos}), pero el sitio las abre recién el ${fecha(c.inicio_at)}.`;
  if (c.cierre_at && ahora > Date.parse(c.cierre_at)) return `Habilitadas (${activos}), pero la vigencia terminó el ${fecha(c.cierre_at)}.`;
  return `Habilitadas (${activos}), pero falta configuración para abrir el sitio.`;
}

function render(d: RespuestaEstado): void {
  ultimo = d;
  const c = d.config;
  const estado = $<HTMLElement>('#ce-estado');
  estado.textContent = ETIQUETA[d.estado];
  estado.className = `ce-estado ce-estado--${d.estado.toLowerCase()}`;
  $<HTMLElement>('#ce-descripcion').textContent = descripcion(d);

  const aviso = $<HTMLElement>('#ce-aviso');
  aviso.hidden = !d.inicioAdelantado;
  aviso.textContent = d.inicioAdelantado
    ? 'Inicio adelantado para pruebas: si las compras están habilitadas, cualquier visitante del sitio puede comprar desde ya. Al terminar, restablece el inicio oficial e invalida las participaciones de prueba.'
    : '';

  const cerrado = d.estado === 'SORTEO_CERRADO';
  const bCompras = $<HTMLButtonElement>('#ce-compras');
  bCompras.textContent = c.checkout_habilitado ? 'Deshabilitar compras' : 'Habilitar compras';
  bCompras.className = `admin-btn ${c.checkout_habilitado ? 'admin-btn--secundario' : ''}`;
  bCompras.dataset.accion = c.checkout_habilitado ? 'deshabilitar_compras' : 'habilitar_compras';
  bCompras.disabled = cerrado && !c.checkout_habilitado;
  $<HTMLElement>('#ce-compras-texto').textContent = c.checkout_habilitado ? 'Habilitadas' : 'Deshabilitadas';

  const bGratis = $<HTMLButtonElement>('#ce-gratis');
  bGratis.textContent = c.participacion_habilitada ? 'Deshabilitar' : 'Habilitar';
  bGratis.className = `admin-btn ${c.participacion_habilitada ? 'admin-btn--secundario' : ''}`;
  bGratis.dataset.accion = c.participacion_habilitada ? 'deshabilitar_gratis' : 'habilitar_gratis';
  bGratis.disabled = cerrado && !c.participacion_habilitada;
  $<HTMLElement>('#ce-gratis-texto').textContent = c.participacion_habilitada ? 'Habilitada' : 'Deshabilitada';

  $<HTMLElement>('#ce-fechas').innerHTML = `
    <div><dt>Inicio</dt><dd>${esc(fecha(c.inicio_at))}</dd></div>
    <div><dt>Cierre</dt><dd>${esc(fecha(c.cierre_at))}</dd></div>
    <div><dt>Sorteo</dt><dd>${esc(fecha(c.sorteo_at))}</dd></div>`;

  const faltaConfig = d.chequeos.some((x) => !x.ok && ['bases', 'fechas', 'premios', 'pasarela', 'correo'].includes(x.id));
  const acciones: string[] = [];
  if (faltaConfig && !cerrado) {
    acciones.push('<button type="button" class="admin-btn admin-btn--secundario" data-accion="aplicar_config_bases">Completar configuración según las bases</button>');
  }
  if (!cerrado) {
    acciones.push(
      d.inicioAdelantado
        ? `<button type="button" class="admin-btn admin-btn--secundario" data-accion="inicio_oficial">Restablecer inicio oficial (${esc(fecha(d.oficiales.inicio))})</button>`
        : Date.now() < Date.parse(d.oficiales.inicio)
          ? '<button type="button" class="admin-btn admin-btn--secundario" data-accion="inicio_ahora">Adelantar inicio para pruebas</button>'
          : '',
    );
  }
  if (d.participacionesPrueba > 0) {
    acciones.push(
      `<button type="button" class="admin-btn admin-btn--peligro" data-accion="invalidar_pruebas">Invalidar participaciones de prueba (${d.participacionesPrueba})</button>`,
    );
  }
  $<HTMLElement>('#ce-acciones').innerHTML = acciones.join('');

  const fallidos = d.chequeos.filter((x) => !x.ok).length;
  const lista = $<HTMLDetailsElement>('#ce-chequeos');
  lista.open = fallidos > 0;
  $<HTMLElement>('#ce-chequeos-resumen').textContent =
    fallidos === 0 ? 'Requisitos: todos cumplidos' : `Requisitos: faltan ${fallidos} de ${d.chequeos.length}`;
  $<HTMLElement>('#ce-chequeos-lista').innerHTML = d.chequeos
    .map(
      (x) => `<li class="ce-chequeo ${x.ok ? 'ce-chequeo--ok' : 'ce-chequeo--falta'}">
        <span class="ce-chequeo__marca" aria-hidden="true">${x.ok ? '✓' : '✕'}</span>
        <span>${esc(x.label)}${!x.ok && x.detalle ? `<br><span class="cc-sub">${esc(x.detalle)}</span>` : ''}</span>
        <span class="visually-hidden">${x.ok ? 'cumplido' : 'pendiente'}</span>
      </li>`,
    )
    .join('');
}

const CONFIRMACION: Record<string, string> = {
  habilitar_compras: '¿Habilitar las compras? Si la campaña está dentro de su periodo, el sitio empieza a vender de inmediato.',
  deshabilitar_compras: '¿Deshabilitar las compras? Nadie podrá comprar hasta que las vuelvas a habilitar.',
  habilitar_gratis: '¿Habilitar la participación sin compra?',
  deshabilitar_gratis: '¿Deshabilitar la participación sin compra?',
  inicio_ahora: '¿Adelantar el inicio a este momento para hacer pruebas? Mientras las compras estén habilitadas, cualquier visitante podrá comprar.',
  inicio_oficial: '¿Restablecer el inicio oficial de las bases?',
  invalidar_pruebas:
    'Se invalidarán todas las participaciones activas creadas antes del inicio oficial (pruebas y registros anteriores). Esta acción no se puede deshacer. ¿Continuar?',
};

async function ejecutar(accion: string, boton: HTMLButtonElement): Promise<void> {
  const pregunta = CONFIRMACION[accion];
  if (pregunta && !confirm(pregunta)) return;
  const error = $<HTMLElement>('#ce-error');
  error.hidden = true;
  boton.disabled = true;
  try {
    render(await llamar('POST', accion));
  } catch (e) {
    error.textContent = e instanceof Error ? e.message : 'No se pudo aplicar el cambio.';
    error.hidden = false;
    if (ultimo) render(ultimo);
  }
}

export async function iniciarEstadoCampana(cliente: SupabaseClient): Promise<void> {
  supabase = cliente;
  const panel = $<HTMLElement>('#ce-panel');
  try {
    render(await llamar('GET'));
    panel.hidden = false;
  } catch (e) {
    const error = $<HTMLElement>('#ce-error');
    error.textContent = e instanceof Error ? e.message : 'No se pudo leer el estado de la campaña.';
    error.hidden = false;
    panel.hidden = false;
  }
  panel.addEventListener('click', (evt) => {
    const boton = (evt.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
    if (boton && !boton.disabled) void ejecutar(boton.dataset.accion!, boton);
  });
}
