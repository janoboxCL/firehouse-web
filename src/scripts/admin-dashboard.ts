import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  obtenerAdmins,
  filtrarCasos,
  casoEstaVencido,
  casoEsParaHoy,
  edadDeAtleta,
  nombreAdminDe,
  actualizarProgramaCaso,
  agruparPorApoderado,
  ordenarGruposPorUrgencia,
  type CasoResumen,
  type GrupoApoderado,
  type FiltrosCasos,
  type AdminMini,
} from '../lib/crm/admin-api.ts';
import { CRM_JOURNEYS_LABEL, CRM_ESTADOS_LABEL, CRM_ESTADOS } from '../lib/crm/constants.ts';
import { formatearFecha, claseBadgeEstado, escaparHtml, mensajeErrorSupabase } from '../lib/crm/format.ts';
import {
  contarPorPrograma,
  leerSeleccion,
  montarSelectorPrograma,
  coincidePrograma,
  type SeleccionPrograma,
} from '../lib/crm/programa-filtro.ts';
import { PROGRAMAS_LABEL, esPrograma } from '../lib/crm/programas.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

let TODOS_LOS_CASOS: CasoResumen[] = [];
let ADMINS: AdminMini[] = [];
let PROGRAMA: SeleccionPrograma = 'TODOS';
let SUPABASE: SupabaseClient;

/** Atajos por programa: fijan los filtros de journey y estado. */
const ATAJOS: Record<SeleccionPrograma, Array<{ etiqueta: string; journey?: string; estado?: string }>> = {
  TODOS: [],
  ALL_STAR: [{ etiqueta: 'Inscritos', estado: 'INSCRITO' }],
  STAR: [
    { etiqueta: 'Clase de prueba', journey: 'CLASE_PRUEBA_STAR' },
    { etiqueta: 'Kit pendiente de pago', journey: 'FIREHOUSE_STAR', estado: 'NUEVO' },
    { etiqueta: 'Inscritos', estado: 'INSCRITO' },
  ],
  SIN_PROGRAMA: [],
};

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

function leerFiltros(): FiltrosCasos {
  return {
    journey: $<HTMLSelectElement>('#f-journey')?.value || undefined,
    estado: $<HTMLSelectElement>('#f-estado')?.value || undefined,
    responsableId: $<HTMLSelectElement>('#f-responsable')?.value || undefined,
    fecha: ($<HTMLSelectElement>('#f-fecha')?.value as FiltrosCasos['fecha']) || 'TODOS',
    busqueda: $<HTMLInputElement>('#f-busqueda')?.value || undefined,
    programa: PROGRAMA,
  };
}

function hayFiltrosActivos(): boolean {
  const f = leerFiltros();
  return !!(f.journey || f.estado || f.responsableId || (f.fecha && f.fecha !== 'TODOS') || f.busqueda);
}

function renderAtajos(): void {
  const f = leerFiltros();
  $<HTMLElement>('#db-atajos')!.innerHTML = ATAJOS[PROGRAMA]
    .map((a, i) => {
      const activo = (a.journey ?? '') === (f.journey ?? '') && (a.estado ?? '') === (f.estado ?? '');
      return `<button type="button" class="db-atajo" data-atajo="${i}" aria-pressed="${activo}">${escaparHtml(a.etiqueta)}</button>`;
    })
    .join('');
  $<HTMLButtonElement>('#f-limpiar')!.hidden = !hayFiltrosActivos();
}

function renderKPIs(casos: CasoResumen[]): void {
  const ahora = new Date();
  const nuevos = casos.filter((c) => c.estado === CRM_ESTADOS.NUEVO);
  const pendientesHoy = casos.filter((c) => casoEsParaHoy(c, ahora) || casoEstaVencido(c, ahora));
  const agendados = casos.filter((c) => c.estado === CRM_ESTADOS.AGENDADO);
  const inscritos = casos.filter((c) => c.estado === CRM_ESTADOS.INSCRITO);
  const veinticuatroHorasMs = 24 * 60 * 60 * 1000;
  const sinContactar24h = nuevos.filter((c) => ahora.getTime() - new Date(c.created_at).getTime() > veinticuatroHorasMs);

  $('#kpi-nuevos')!.textContent = String(nuevos.length);
  $('#kpi-pendientes-hoy')!.textContent = String(pendientesHoy.length);
  $('#kpi-agendados')!.textContent = String(agendados.length);
  $('#kpi-inscritos')!.textContent = String(inscritos.length);
  $('#kpi-sin-contactar')!.textContent = String(sinContactar24h.length);
}

function celdaPrograma(caso: CasoResumen): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'db-celda-programa';
  if (esPrograma(caso.programa)) {
    td.innerHTML = `<span class="fh-badge-programa fh-badge-programa--${caso.programa.toLowerCase()}">${
      caso.programa === 'STAR' ? 'Star' : 'All Star'
    }</span>`;
    return td;
  }
  // Sin programa: se asigna aquí mismo, sin abrir el caso.
  const select = document.createElement('select');
  select.className = 'db-asignar';
  select.setAttribute('aria-label', `Asignar programa a ${caso.atleta.nombre}`);
  select.innerHTML = `<option value="">Asignar programa</option>
    <option value="STAR">${PROGRAMAS_LABEL.STAR}</option>
    <option value="ALL_STAR">${PROGRAMAS_LABEL.ALL_STAR}</option>`;
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', async (e) => {
    e.stopPropagation();
    if (!select.value) return;
    select.disabled = true;
    try {
      await actualizarProgramaCaso(SUPABASE, caso.id, select.value);
      caso.programa = select.value;
      actualizarSelectorPrograma();
      renderizar();
    } catch (err) {
      mostrarError(mensajeErrorSupabase(err, 'No pudimos asignar el programa.'));
      select.disabled = false;
    }
  });
  td.appendChild(select);
  return td;
}

function filaAtleta(caso: CasoResumen): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.addEventListener('click', (evt) => {
    evt.stopPropagation(); // no abrir también la ficha del apoderado
    window.location.href = `/admin/caso?id=${caso.id}`;
  });

  const edad = edadDeAtleta(caso.atleta);
  const vencido = casoEstaVencido(caso);
  const paraHoy = casoEsParaHoy(caso);

  const celdaFecha = document.createElement('td');
  let textoFecha = formatearFecha(caso.fecha_proxima_accion);
  if (paraHoy) textoFecha = 'Hoy';
  if (vencido) celdaFecha.classList.add('db-fila__vencido');
  celdaFecha.textContent = caso.fecha_proxima_accion ? textoFecha : '—';

  tr.innerHTML = `
    <td>${escaparHtml(`${caso.atleta.nombre} ${caso.atleta.apellidos}`)} ${edad !== null ? `(${edad})` : ''}</td>
    <td class="db-celda-programa"></td>
    <td><span class="admin-badge admin-badge--journey">${escaparHtml(CRM_JOURNEYS_LABEL[caso.journey] ?? caso.journey)}</span></td>
    <td><span class="admin-badge ${claseBadgeEstado(caso.estado)}">${escaparHtml(CRM_ESTADOS_LABEL[caso.estado] ?? caso.estado)}</span></td>
    <td>${escaparHtml(caso.proxima_accion ?? '—')}</td>
    <td></td>
    <td>${escaparHtml(nombreAdminDe(ADMINS, caso.responsable_id))}</td>
  `;
  tr.children[5].replaceWith(celdaFecha);
  tr.children[1].replaceWith(celdaPrograma(caso));
  return tr;
}

function tarjetaFamilia(grupo: GrupoApoderado): HTMLElement {
  const card = document.createElement('div');
  card.className = 'familia-card';

  const header = document.createElement('div');
  header.className = 'familia-card__header';
  header.innerHTML = `
    <div>
      <p class="familia-card__nombre">${escaparHtml(`${grupo.apoderado.nombre} ${grupo.apoderado.apellidos}`)}</p>
      <p class="familia-card__contacto">${escaparHtml(grupo.apoderado.telefono)} · ${escaparHtml(grupo.apoderado.email)}</p>
    </div>
  `;
  header.addEventListener('click', () => {
    window.location.href = `/admin/apoderado?id=${grupo.apoderado.id}`;
  });

  const tabla = document.createElement('table');
  tabla.className = 'familia-card__atletas';
  const cuerpo = document.createElement('tbody');
  grupo.casos.forEach((c) => cuerpo.appendChild(filaAtleta(c)));
  tabla.appendChild(cuerpo);

  card.append(header, tabla);
  return card;
}

function actualizarSelectorPrograma(): void {
  montarSelectorPrograma($<HTMLElement>('#db-programa')!, contarPorPrograma(TODOS_LOS_CASOS), PROGRAMA, (v) => {
    PROGRAMA = v;
    // Los atajos dependen del programa: al cambiarlo se limpian journey y estado.
    $<HTMLSelectElement>('#f-journey')!.value = '';
    $<HTMLSelectElement>('#f-estado')!.value = '';
    renderizar();
  });
}

function renderizar(): void {
  const filtros = leerFiltros();
  renderKPIs(TODOS_LOS_CASOS.filter((c) => coincidePrograma(c.programa, PROGRAMA)));
  renderAtajos();
  const filtrados = filtrarCasos(TODOS_LOS_CASOS, filtros);
  const grupos = ordenarGruposPorUrgencia(agruparPorApoderado(filtrados));

  const contenedor = $<HTMLElement>('#db-familias')!;
  const vacio = $<HTMLElement>('#db-vacio')!;
  contenedor.innerHTML = '';

  if (grupos.length === 0) {
    contenedor.hidden = true;
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.hidden = false;
  const frag = document.createDocumentFragment();
  grupos.forEach((g) => frag.appendChild(tarjetaFamilia(g)));
  contenedor.appendChild(frag);
}

function poblarSelectResponsables(): void {
  const select = $<HTMLSelectElement>('#f-responsable')!;
  ADMINS.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.user_id;
    opt.textContent = a.display_name || a.role;
    select.appendChild(opt);
  });
}

function mostrarError(mensaje: string): void {
  const el = $<HTMLElement>('#dashboard-error')!;
  el.textContent = mensaje;
  el.hidden = false;
  $('#db-cargando')!.setAttribute('hidden', '');
}

export async function iniciarDashboard(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  try {
    [TODOS_LOS_CASOS, ADMINS] = await Promise.all([obtenerCasos(supabase), obtenerAdmins(supabase)]);
  } catch {
    mostrarError('No pudimos cargar los casos. Recarga la página o inténtalo más tarde.');
    return;
  }

  $('#db-cargando')!.setAttribute('hidden', '');
  SUPABASE = supabase;
  PROGRAMA = leerSeleccion();
  if (PROGRAMA === 'SIN_PROGRAMA' && contarPorPrograma(TODOS_LOS_CASOS).SIN_PROGRAMA === 0) PROGRAMA = 'TODOS';
  poblarSelectResponsables();
  actualizarSelectorPrograma();
  renderizar();

  $('#db-atajos')?.addEventListener('click', (evt) => {
    const b = (evt.target as HTMLElement).closest<HTMLButtonElement>('button[data-atajo]');
    if (!b) return;
    const atajo = ATAJOS[PROGRAMA][Number(b.dataset.atajo)];
    const yaActivo = b.getAttribute('aria-pressed') === 'true';
    $<HTMLSelectElement>('#f-journey')!.value = yaActivo ? '' : atajo.journey ?? '';
    $<HTMLSelectElement>('#f-estado')!.value = yaActivo ? '' : atajo.estado ?? '';
    renderizar();
  });

  ['#f-journey', '#f-estado', '#f-responsable', '#f-fecha'].forEach((sel) => {
    $(sel)?.addEventListener('change', renderizar);
  });
  $('#f-busqueda')?.addEventListener('input', debounce(renderizar, 250));

  $('#f-limpiar')?.addEventListener('click', () => {
    $<HTMLSelectElement>('#f-journey')!.value = '';
    $<HTMLSelectElement>('#f-estado')!.value = '';
    $<HTMLSelectElement>('#f-responsable')!.value = '';
    $<HTMLSelectElement>('#f-fecha')!.value = 'TODOS';
    $<HTMLInputElement>('#f-busqueda')!.value = '';
    renderizar();
  });
}
