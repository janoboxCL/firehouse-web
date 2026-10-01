// Página Estadísticas por programa: edades, comunas, familias con hermanos,
// asistencia por día, de clase de prueba a inscripción y cómo nos conocieron.
// Un solo color para los datos (magnitud), cifras escritas en cada barra y
// una tabla con los datos debajo de cada gráfico.

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  calcularEmbudo,
  calcularEstadisticas,
  construirSesiones,
  fechaCorta,
  numeroTexto,
  porcentajeTexto,
  type Barra,
  type FiltroPrograma,
} from '../lib/crm/deportistas.ts';
import { escaparHtml, mensajeErrorSupabase } from '../lib/crm/format.ts';
import { $, cargarDatosCrm, type DatosCrm } from './crm-datos.ts';

let DATOS: DatosCrm | null = null;
let PROGRAMA: FiltroPrograma = 'STAR';

const pct = (n: number, total: number) => porcentajeTexto(total > 0 ? n / total : null);

function tabla(cabeza: [string, string], filas: Array<[string, string]>): string {
  return `<details class="es-tabla"><summary>Ver datos en tabla</summary><table><thead><tr><th>${escaparHtml(cabeza[0])}</th><th>${escaparHtml(
    cabeza[1],
  )}</th></tr></thead><tbody>${filas.map(([a, b]) => `<tr><td>${escaparHtml(a)}</td><td>${escaparHtml(b)}</td></tr>`).join('')}</tbody></table></details>`;
}

function cabecera(titulo: string, sub = ''): string {
  return `<div class="es-card__cab"><h2>${escaparHtml(titulo)}</h2>${sub ? `<span class="es-card__sub">${escaparHtml(sub)}</span>` : ''}</div>`;
}

/** Barras verticales: `etiquetas` bajo cada barra, `textos` sobre ella. */
function columnas(valores: number[], etiquetas: string[], textos: string[], titulos: string[]): string {
  const max = Math.max(1, ...valores);
  const cols = `grid-template-columns: repeat(${valores.length}, minmax(0, 1fr))`;
  return `
    <div class="es-col" style="${cols}">${valores
      .map(
        (v, i) => `<div class="es-col__item" title="${escaparHtml(titulos[i])}"><span class="es-col__n">${escaparHtml(textos[i])}</span><span class="es-col__barra" style="height:${Math.round(
          (v / max) * 140,
        )}px"></span></div>`,
      )
      .join('')}</div>
    <div class="es-col__ejes" aria-hidden="true" style="${cols}">${etiquetas.map((e) => `<span>${escaparHtml(e)}</span>`).join('')}</div>`;
}

function filasHorizontales(barras: Barra[], total: number): string {
  const max = Math.max(1, ...barras.map((b) => b.n));
  return barras
    .map(
      (b) => `<div class="es-fila" title="${escaparHtml(`${b.etiqueta}: ${b.n}`)}"><span class="es-fila__etq">${escaparHtml(b.etiqueta)}</span><span class="es-fila__pista"><span class="es-fila__barra" style="display:block;width:${Math.round(
        (b.n / max) * 100,
      )}%"></span></span><span class="es-fila__n"><strong>${b.n}</strong> <small>${pct(b.n, total)}</small></span></div>`,
    )
    .join('');
}

function kpi(label: string, valor: string, nota: string): string {
  return `<div class="es-kpi"><p class="es-kpi__label">${escaparHtml(label)}</p><p class="es-kpi__valor">${escaparHtml(valor)}</p><p class="es-kpi__nota">${escaparHtml(
    nota,
  )}</p></div>`;
}

function dibujar(): void {
  if (!DATOS) return;
  document.querySelectorAll<HTMLButtonElement>('#es-programa [data-valor]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.valor === PROGRAMA));
  });

  const activos = DATOS.filas.filter((f) => f.activo && (PROGRAMA === 'TODOS' || f.programa === PROGRAMA));
  const sesiones = construirSesiones(DATOS.filas, DATOS.asistencias, DATOS.config.starPrimeraClase);
  const e = calcularEstadisticas(activos, sesiones);
  const anio = DATOS.hoy.slice(0, 4);

  // Resumen
  const cuartoKpi =
    PROGRAMA === 'STAR'
      ? kpi('Kit pendiente de pago', String(e.kitPendiente), `de ${e.deportistas} inscripciones`)
      : kpi('Edad promedio', e.edadPromedio === null ? '—' : `${numeroTexto(e.edadPromedio)} años`, 'a la fecha de hoy');
  $<HTMLElement>('#es-kpis')!.innerHTML = [
    kpi('Deportistas', String(e.deportistas), 'activos en el programa'),
    kpi('Familias', String(e.familias), `${e.familiasConHermanos} con 2 o más hijos`),
    kpi('Asistencia promedio', porcentajeTexto(e.asistenciaPromedio), e.sesiones.length ? `${e.totalAsistencias} asistencias en ${e.sesiones.length} días` : 'sin asistencia grabada'),
    cuartoKpi,
  ].join('');

  // Edades
  $<HTMLElement>('#es-edades')!.innerHTML = e.edades.length
    ? cabecera('Edades', e.edadPromedio === null ? '' : `Promedio ${numeroTexto(e.edadPromedio)} años`) +
      columnas(
        e.edades.map((b) => b.n),
        e.edades.map((b) => b.etiqueta),
        e.edades.map((b) => String(b.n)),
        e.edades.map((b) => `${b.etiqueta} años: ${b.n}`),
      ) +
      '<span class="es-card__sub" style="text-align:center">años cumplidos</span>' +
      tabla(['Edad', 'Deportistas'], e.edades.map((b) => [`${b.etiqueta} años`, String(b.n)]))
    : cabecera('Edades') + '<p class="es-vacio">Sin datos.</p>';

  // Comunas
  $<HTMLElement>('#es-comunas')!.innerHTML =
    cabecera('Comunas') +
    (e.comunas.length
      ? filasHorizontales(e.comunas, e.deportistas) + tabla(['Comuna', 'Deportistas'], e.comunas.map((b) => [b.etiqueta, String(b.n)]))
      : '<p class="es-vacio">Sin datos.</p>');

  // Asistencia por día (últimos 8)
  const ult = e.sesiones.slice(-8);
  $<HTMLElement>('#es-asistencia')!.innerHTML =
    cabecera('Asistencia por día', ult.length ? 'presentes de los que les correspondía' : '') +
    (ult.length
      ? columnas(
          ult.map((s) => s.presentes / s.esperados),
          ult.map((s) => fechaCorta(s.fecha, anio)),
          ult.map((s) => `${s.presentes}/${s.esperados}`),
          ult.map((s) => `${fechaCorta(s.fecha, anio)}: ${s.presentes} de ${s.esperados} (${pct(s.presentes, s.esperados)})`),
        ) +
        tabla(['Día', 'Presentes'], ult.map((s) => [fechaCorta(s.fecha, anio), `${s.presentes} de ${s.esperados} · ${pct(s.presentes, s.esperados)}`]))
      : '<p class="es-vacio">Todavía no hay asistencia grabada para este programa.</p>');

  // Familias por número de deportistas
  const solos = e.familias - e.familiasConHermanos;
  const familias: Barra[] = [
    { etiqueta: '1 deportista', n: solos },
    { etiqueta: '2 o más', n: e.familiasConHermanos },
  ];
  $<HTMLElement>('#es-familias')!.innerHTML =
    cabecera('Familias por número de hijos') +
    (e.familias
      ? filasHorizontales(familias, e.familias) +
        `<p class="es-card__sub">Las familias con 2 o más hijos suman ${e.deportistasConHermanos} deportistas (${pct(e.deportistasConHermanos, e.deportistas)} del total).</p>`
      : '<p class="es-vacio">Sin datos.</p>');

  // De clase de prueba a inscripción (toda la academia)
  const emb = calcularEmbudo(DATOS.casos, DATOS.asistencias, DATOS.hoy);
  const pasos: Array<[string, number, string]> = [
    ['Clases de prueba realizadas', emb.realizadas, ''],
    ['Asistieron', emb.asistieron, pct(emb.asistieron, emb.realizadas)],
    ['Se inscribieron', emb.inscritas, emb.asistieron ? `${pct(emb.inscritas, emb.asistieron)} de quienes asistieron` : ''],
  ];
  $<HTMLElement>('#es-embudo')!.innerHTML =
    cabecera('De clase de prueba a inscripción', 'toda la academia') +
    (emb.realizadas
      ? pasos
          .map(
            ([t, n, nota]) =>
              `<div class="es-embudo__paso"><span class="es-embudo__txt"><span>${escaparHtml(t)}</span><span><strong>${n}</strong> <small>${escaparHtml(
                nota,
              )}</small></span></span><span class="es-embudo__barra" style="width:${Math.round((n / emb.realizadas) * 100)}%"></span></div>`,
          )
          .join('')
      : '<p class="es-vacio">Todavía no hay clases de prueba realizadas.</p>');

  // Cómo nos conocieron
  $<HTMLElement>('#es-conocio')!.innerHTML =
    cabecera('Cómo nos conocieron') +
    (e.comoConocio.length
      ? filasHorizontales(e.comoConocio, e.deportistas) + tabla(['Canal', 'Deportistas'], e.comoConocio.map((b) => [b.etiqueta, String(b.n)]))
      : '<p class="es-vacio">Sin datos.</p>');
}

async function cargar(supabase: SupabaseClient): Promise<void> {
  try {
    DATOS = await cargarDatosCrm(supabase);
  } catch (err) {
    const el = $<HTMLElement>('#es-error')!;
    el.textContent = mensajeErrorSupabase(err, 'No pudimos cargar las estadísticas. Recarga la página.');
    el.hidden = false;
    return;
  } finally {
    $('#es-cargando')?.setAttribute('hidden', '');
  }
  const fecha = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${DATOS.hoy}T12:00:00Z`),
  );
  $<HTMLElement>('#es-fecha')!.textContent = `Datos al ${fecha}`;
  const aviso = $<HTMLElement>('#es-aviso')!;
  aviso.hidden = DATOS.asistenciaDisponible;
  aviso.textContent = 'La asistencia aparecerá después de ejecutar la migración 0016 en Supabase.';
  $<HTMLElement>('#es-contenido')!.hidden = false;
  dibujar();
}

export async function iniciarEstadisticas(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);
  $('#es-programa')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-valor]');
    if (!b) return;
    PROGRAMA = b.dataset.valor as FiltroPrograma;
    dibujar();
  });
  await cargar(supabase);
}
