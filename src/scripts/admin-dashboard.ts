import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  obtenerAdmins,
  filtrarCasos,
  ordenarCasos,
  casoEstaVencido,
  casoEsParaHoy,
  edadDeAtleta,
  nombreAdminDe,
  type CasoResumen,
  type FiltrosCasos,
  type AdminMini,
} from '../lib/crm/admin-api.ts';
import { CRM_JOURNEYS_LABEL, CRM_ESTADOS_LABEL, CRM_ESTADOS } from '../lib/crm/constants.ts';
import { formatearFecha, claseBadgeEstado } from '../lib/crm/format.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

let TODOS_LOS_CASOS: CasoResumen[] = [];
let ADMINS: AdminMini[] = [];

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
  };
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

function filaTabla(caso: CasoResumen): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.addEventListener('click', () => {
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
    <td>${caso.atleta.nombre} ${caso.atleta.apellidos}</td>
    <td>${edad ?? '—'}</td>
    <td>${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}</td>
    <td><span class="admin-badge admin-badge--journey">${CRM_JOURNEYS_LABEL[caso.journey] ?? caso.journey}</span></td>
    <td><span class="admin-badge ${claseBadgeEstado(caso.estado)}">${CRM_ESTADOS_LABEL[caso.estado] ?? caso.estado}</span></td>
    <td>${caso.proxima_accion ?? '—'}</td>
    <td></td>
    <td>${nombreAdminDe(ADMINS, caso.responsable_id)}</td>
  `;
  tr.children[6].replaceWith(celdaFecha);
  return tr;
}

function renderizar(): void {
  const filtros = leerFiltros();
  const filtrados = ordenarCasos(filtrarCasos(TODOS_LOS_CASOS, filtros));

  const tabla = $<HTMLTableElement>('#db-tabla')!;
  const vacio = $<HTMLElement>('#db-vacio')!;
  const cuerpo = $<HTMLElement>('#db-tabla-body')!;

  cuerpo.innerHTML = '';

  if (filtrados.length === 0) {
    tabla.hidden = true;
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  tabla.hidden = false;
  const frag = document.createDocumentFragment();
  filtrados.forEach((c) => frag.appendChild(filaTabla(c)));
  cuerpo.appendChild(frag);
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
  poblarSelectResponsables();
  renderKPIs(TODOS_LOS_CASOS);
  renderizar();

  ['#f-journey', '#f-estado', '#f-responsable', '#f-fecha'].forEach((sel) => {
    $(sel)?.addEventListener('change', renderizar);
  });
  $('#f-busqueda')?.addEventListener('input', debounce(renderizar, 250));
}
