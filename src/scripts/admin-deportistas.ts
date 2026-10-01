// Página Deportistas: grilla con los datos clave de cada deportista.
// Móvil: deportista, ingreso, última clase y asistencia. Escritorio: además
// estado, apoderado, comuna, primera clase y kit.

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  asistenciaBaja,
  cumpleExtra,
  cumpleTexto,
  fechaCorta,
  filtrarFilas,
  FILTRO_EXTRA_LABEL,
  ordenarFilas,
  ORDEN_DEPORTISTAS_LABEL,
  PROGRAMA_LABEL,
  proporcion,
  type FilaDeportista,
  type FiltroExtra,
  type FiltroPrograma,
  type OrdenDeportistas,
  type Programa,
} from '../lib/crm/deportistas.ts';
import { escaparHtml, mensajeErrorSupabase } from '../lib/crm/format.ts';
import { $, cargarDatosCrm, descargarCsv, type DatosCrm } from './crm-datos.ts';

let DATOS: DatosCrm | null = null;
let PROGRAMA: FiltroPrograma = 'TODOS';
let EXTRA: FiltroExtra = 'NINGUNO';
let ORDEN: OrdenDeportistas = 'INGRESO';

const PROGRAMA_CORTO: Record<Programa, string> = { STAR: 'Star', ALL_STAR: 'All Star', PRUEBA: 'Prueba', OTRO: 'Sin programa' };
const PROGRAMAS: FiltroPrograma[] = ['TODOS', 'STAR', 'PRUEBA', 'ALL_STAR', 'OTRO'];
const EXTRAS: Array<Exclude<FiltroExtra, 'NINGUNO'>> = ['KIT_PENDIENTE', 'FALTAN', 'RETIRADOS'];

function claseEstado(f: FilaDeportista): string {
  if (!f.activo) return 'dp-estado--no';
  if (f.estado === 'INSCRITO') return 'dp-estado--ok';
  if (f.estado === 'ASISTIO' || f.estado === 'AGENDADO') return 'dp-estado--info';
  return '';
}

function filaHtml(f: FilaDeportista, anio: string): string {
  const baja = asistenciaBaja(f) || f.faltaSeguidas;
  const p = proporcion(f);
  const asist = f.esperadas > 0 ? `${f.asistidas}/${f.esperadas}` : '—';
  const sub = [
    f.edad !== null ? `${f.edad} años` : '',
    PROGRAMA_CORTO[f.programa as Programa],
  ].filter(Boolean).join(' · ');
  const avisos = [
    f.kit === 'PENDIENTE' && f.activo ? '<span class="dp-kit-pend"> · Kit pendiente</span>' : '',
    f.faltaSeguidas ? '<span class="dp-baja"> · Faltó 2 sáb.</span>' : '',
  ].join('');
  const kit = f.kit === 'PAGADO' ? '<span class="dp-kit-ok">Pagado</span>' : f.kit === 'PENDIENTE' ? '<span class="dp-kit-pend">Pendiente</span>' : '—';
  return `
    <tr data-caso="${escaparHtml(f.casoId)}">
      <td>
        <a class="dp-nombre" href="/admin/caso?id=${encodeURIComponent(f.casoId)}">${escaparHtml(f.nombre)}</a>
        <span class="dp-sub">${escaparHtml(sub)}<span class="dp-solo-movil">${avisos}</span><span class="dp-ext">${
          f.faltaSeguidas ? '<span class="dp-baja"> · Faltó 2 sáb.</span>' : ''
        }</span></span>
      </td>
      <td class="dp-ext"><span class="dp-estado ${claseEstado(f)}">${escaparHtml(f.estadoTexto)}</span></td>
      <td class="dp-ext">${escaparHtml(f.apoderado)}<span class="dp-tel">${escaparHtml(f.telefono)}</span></td>
      <td class="dp-ext">${escaparHtml(f.comuna || '—')}</td>
      <td>${fechaCorta(f.ingreso, anio)}</td>
      <td class="dp-ext">${fechaCorta(f.primeraClase, anio)}</td>
      <td>${fechaCorta(f.ultimaClase, anio)}</td>
      <td>
        <span class="dp-asist">
          <span class="dp-asist__barra${baja ? ' dp-asist__barra--baja' : ''}" aria-hidden="true"><span style="width:${
            p === null ? 0 : Math.round(p * 100)
          }%"></span></span>
          <span class="dp-asist__n${baja ? ' dp-baja' : ''}">${asist}</span>
        </span>
      </td>
      <td class="dp-ext">${kit}</td>
    </tr>`;
}

function chip(texto: string, activo: boolean, dato: string, alerta = false): string {
  return `<button type="button" class="dp-chip${alerta ? ' dp-chip--alerta' : ''}" data-valor="${dato}" aria-pressed="${activo}">${escaparHtml(texto)}</button>`;
}

function dibujar(): void {
  if (!DATOS) return;
  const texto = $<HTMLInputElement>('#dp-buscar')!.value;
  const filas = DATOS.filas;

  // Cantidades de cada chip según los demás filtros vigentes.
  $<HTMLElement>('#dp-programas')!.innerHTML = PROGRAMAS.map((p) => {
    const n = filas.filter((f) => (p === 'TODOS' || f.programa === p) && cumpleExtra(f, EXTRA) && cumpleTexto(f, texto)).length;
    if (n === 0 && p !== 'TODOS' && p !== PROGRAMA) return '';
    return chip(`${p === 'TODOS' ? 'Todos' : PROGRAMA_LABEL[p]} · ${n}`, p === PROGRAMA, p);
  }).join('');
  $<HTMLElement>('#dp-extras')!.innerHTML = EXTRAS.map((e) => {
    const n = filtrarFilas(filas, PROGRAMA, e, texto).length;
    return chip(`${FILTRO_EXTRA_LABEL[e]} · ${n}`, e === EXTRA, e, e === 'FALTAN' && n > 0);
  }).join('');

  const visibles = ordenarFilas(filtrarFilas(filas, PROGRAMA, EXTRA, texto), ORDEN);
  const activos = filas.filter((f) => f.activo);
  const familias = new Set(activos.map((f) => f.apoderadoId)).size;
  $<HTMLElement>('#dp-resumen')!.textContent = `${activos.length} deportistas activos · ${familias} familias${
    visibles.length !== activos.length ? ` · mostrando ${visibles.length}` : ''
  }`;

  const anio = DATOS.hoy.slice(0, 4);
  $<HTMLElement>('#dp-cuerpo')!.innerHTML = visibles.map((f) => filaHtml(f, anio)).join('');
  $<HTMLElement>('#dp-tabla')!.hidden = visibles.length === 0;
  $<HTMLElement>('#dp-vacio')!.hidden = visibles.length > 0;
}

function exportar(): void {
  if (!DATOS) return;
  const visibles = ordenarFilas(filtrarFilas(DATOS.filas, PROGRAMA, EXTRA, $<HTMLInputElement>('#dp-buscar')!.value), ORDEN);
  descargarCsv(`deportistas-${DATOS.hoy}.csv`, [
    ['Deportista', 'Edad', 'Programa', 'Estado', 'Apoderado/a', 'Teléfono', 'Correo', 'Comuna', 'Ingreso', 'Primera clase', 'Última clase', 'Asistió', 'Le correspondían', 'Kit'],
    ...visibles.map((f) => [
      f.nombre,
      f.edad ?? '',
      PROGRAMA_LABEL[f.programa],
      f.estadoTexto,
      f.apoderado,
      f.telefono,
      f.email,
      f.comuna,
      f.ingreso,
      f.primeraClase ?? '',
      f.ultimaClase ?? '',
      f.asistidas,
      f.esperadas,
      f.kit === 'PAGADO' ? 'Pagado' : f.kit === 'PENDIENTE' ? 'Pendiente' : '',
    ]),
  ]);
}

function conectar(): void {
  const orden = $<HTMLSelectElement>('#dp-orden')!;
  orden.innerHTML = (Object.keys(ORDEN_DEPORTISTAS_LABEL) as OrdenDeportistas[])
    .map((o) => `<option value="${o}">Ordenar: ${ORDEN_DEPORTISTAS_LABEL[o]}</option>`)
    .join('');
  orden.addEventListener('change', () => {
    ORDEN = orden.value as OrdenDeportistas;
    dibujar();
  });
  $('#dp-buscar')!.addEventListener('input', () => dibujar());
  $('#dp-programas')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-valor]');
    if (!b) return;
    PROGRAMA = b.dataset.valor as FiltroPrograma;
    dibujar();
  });
  $('#dp-extras')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-valor]');
    if (!b) return;
    const v = b.dataset.valor as FiltroExtra;
    EXTRA = EXTRA === v ? 'NINGUNO' : v;
    dibujar();
  });
  // Toda la fila abre la ficha (el nombre es el enlace accesible).
  $('#dp-cuerpo')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) return;
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-caso]');
    if (tr) window.location.href = `/admin/caso?id=${encodeURIComponent(tr.dataset.caso!)}`;
  });
  $('#dp-excel')!.addEventListener('click', exportar);
}

async function cargar(supabase: SupabaseClient): Promise<void> {
  try {
    DATOS = await cargarDatosCrm(supabase);
  } catch (err) {
    const el = $<HTMLElement>('#dp-error')!;
    el.textContent = mensajeErrorSupabase(err, 'No pudimos cargar los deportistas. Recarga la página.');
    el.hidden = false;
    $<HTMLElement>('#dp-resumen')!.textContent = '';
    return;
  }
  const aviso = $<HTMLElement>('#dp-aviso')!;
  aviso.hidden = DATOS.asistenciaDisponible;
  aviso.textContent = 'La última clase y la asistencia aparecerán después de ejecutar la migración 0016 en Supabase.';
  dibujar();
}

export async function iniciarDeportistas(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);
  conectar();
  await cargar(supabase);
}
