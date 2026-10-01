// Página Asistencia: cada día con asistencia grabada (presentes de los que les
// correspondía venir), quiénes faltaron y quiénes llevan 2 sábados sin venir.

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  construirSesiones,
  fechaCorta,
  porcentajeTexto,
  PROGRAMA_LABEL,
  type FilaDeportista,
  type Sesion,
} from '../lib/crm/deportistas.ts';
import { escaparHtml, mensajeErrorSupabase } from '../lib/crm/format.ts';
import { $, cargarDatosCrm, descargarCsv, type DatosCrm } from './crm-datos.ts';

type FiltroAsistencia = 'TODOS' | 'STAR' | 'PRUEBA';
let DATOS: DatosCrm | null = null;
let PROGRAMA: FiltroAsistencia = 'TODOS';

function tituloFecha(iso: string): string {
  const t = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function itemDeportista(f: FilaDeportista): string {
  return `<li><a href="/admin/caso?id=${encodeURIComponent(f.casoId)}">${escaparHtml(f.nombre)}</a><small>${
    f.edad !== null ? `${f.edad} años · ` : ''
  }${escaparHtml(PROGRAMA_LABEL[f.programa])}</small></li>`;
}

function sesionHtml(s: Sesion, abierta: boolean): string {
  const p = s.esperados > 0 ? s.presentes.length / s.esperados : null;
  const orden = (a: FilaDeportista, b: FilaDeportista) => a.nombre.localeCompare(b.nombre, 'es');
  return `
    <details class="as-sesion" ${abierta ? 'open' : ''}>
      <summary>
        <span class="as-sesion__fila">
          <span class="as-sesion__fecha">${escaparHtml(tituloFecha(s.fecha))}</span>
          <span class="as-sesion__total"><strong>${s.presentes.length}</strong> de ${s.esperados} · ${porcentajeTexto(p)}</span>
        </span>
        <span class="as-barra" aria-hidden="true"><span style="width:${p === null ? 0 : Math.round(p * 100)}%"></span></span>
      </summary>
      <div class="as-sesion__cuerpo">
        <div>
          <h3>No vinieron · ${s.ausentes.length}</h3>
          <ul class="as-lista">${[...s.ausentes].sort(orden).map(itemDeportista).join('') || '<li><small>Vinieron todos.</small></li>'}</ul>
        </div>
        <details class="as-vinieron">
          <summary><h3>Vinieron · ${s.presentes.length} <span class="as-ver">ver lista</span></h3></summary>
          <ul class="as-lista">${[...s.presentes].sort(orden).map(itemDeportista).join('')}</ul>
        </details>
        <div class="as-sesion__pie"><button type="button" class="as-link" data-excel="${s.fecha}">Descargar en Excel</button></div>
      </div>
    </details>`;
}

function filasDelPrograma(): FilaDeportista[] {
  if (!DATOS) return [];
  return PROGRAMA === 'TODOS' ? DATOS.filas : DATOS.filas.filter((f) => f.programa === PROGRAMA);
}

function sesionesVisibles(): Sesion[] {
  if (!DATOS) return [];
  return construirSesiones(filasDelPrograma(), DATOS.asistencias, DATOS.config.starPrimeraClase)
    .map((s) =>
      // En Star, quien vino antes de su primera clase Star vino a una clase de prueba: no cuenta acá.
      PROGRAMA === 'STAR'
        ? { ...s, presentes: s.presentes.filter((f) => !!f.primeraClase && f.primeraClase <= s.fecha) }
        : s,
    )
    .map((s) => ({ ...s, esperados: s.presentes.length + s.ausentes.length }))
    .filter((s) => s.esperados > 0);
}

function dibujar(): void {
  if (!DATOS) return;
  document.querySelectorAll<HTMLButtonElement>('#as-programa [data-valor]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.valor === PROGRAMA));
  });
  const sesiones = sesionesVisibles();
  const presentes = sesiones.reduce((s, x) => s + x.presentes.length, 0);
  const esperados = sesiones.reduce((s, x) => s + x.esperados, 0);
  const faltan = filasDelPrograma().filter((f) => f.faltaSeguidas);

  $<HTMLElement>('#as-k-promedio')!.textContent = porcentajeTexto(esperados ? presentes / esperados : null);
  $<HTMLElement>('#as-k-sesiones')!.textContent = String(sesiones.length);
  const kFaltan = $<HTMLElement>('#as-k-faltan')!;
  kFaltan.textContent = String(faltan.length);
  kFaltan.classList.toggle('as-kpi__valor--alerta', faltan.length > 0);

  const anio = DATOS.hoy.slice(0, 4);
  $<HTMLElement>('#as-faltan')!.hidden = faltan.length === 0;
  $<HTMLElement>('#as-faltan-lista')!.innerHTML = faltan
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(
      (f) =>
        `<li><a href="/admin/caso?id=${encodeURIComponent(f.casoId)}">${escaparHtml(f.nombre)}</a><small>Última: ${fechaCorta(
          f.ultimaClase,
          anio,
        )} · ${escaparHtml(f.apoderado)} · <a href="tel:${escaparHtml(f.telefono.replace(/[^+\d]/g, ''))}">${escaparHtml(f.telefono)}</a></small></li>`,
    )
    .join('');

  $<HTMLElement>('#as-vacio')!.hidden = sesiones.length > 0;
  $<HTMLElement>('#as-sesiones')!.innerHTML = sesiones.map((s, i) => sesionHtml(s, i === 0)).join('');
}

function exportarSesion(fecha: string): void {
  const s = sesionesVisibles().find((x) => x.fecha === fecha);
  if (!s) return;
  const fila = (f: FilaDeportista, vino: string) => [f.nombre, f.edad ?? '', PROGRAMA_LABEL[f.programa], vino, f.apoderado, f.telefono];
  descargarCsv(`asistencia-${fecha}.csv`, [
    ['Deportista', 'Edad', 'Programa', 'Asistió', 'Apoderado/a', 'Teléfono'],
    ...s.presentes.map((f) => fila(f, 'Sí')),
    ...s.ausentes.map((f) => fila(f, 'No')),
  ]);
}

async function cargar(supabase: SupabaseClient): Promise<void> {
  try {
    DATOS = await cargarDatosCrm(supabase);
  } catch (err) {
    const el = $<HTMLElement>('#as-error')!;
    el.textContent = mensajeErrorSupabase(err, 'No pudimos cargar la asistencia. Recarga la página.');
    el.hidden = false;
    return;
  } finally {
    $('#as-cargando')?.setAttribute('hidden', '');
  }
  const aviso = $<HTMLElement>('#as-aviso')!;
  aviso.hidden = DATOS.asistenciaDisponible;
  aviso.textContent = 'Falta ejecutar la migración 0016 en Supabase para ver la asistencia.';
  dibujar();
}

export async function iniciarAsistencia(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);
  $('#as-programa')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-valor]');
    if (!b) return;
    PROGRAMA = b.dataset.valor as FiltroAsistencia;
    dibujar();
  });
  $('#as-sesiones')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-excel]');
    if (b) exportarSesion(b.dataset.excel!);
  });
  await cargar(supabase);
}
