// Listado de Clase de prueba: filtros, orden y lista de asistencia (imprimible
// y Excel). Lógica pura, sin DOM.

import type { ItemPrimeraClase } from './admin-api.ts';
import { RELACION_APODERADO_LABEL } from './constants.ts';
import { calcularEdad } from './validation.ts';

// ---------------------------------------------------------------------------
// Filtros y orden

export type FiltroClase =
  | 'TODOS'
  | 'POR_LLEGAR'
  | 'PRESENTES'
  | 'KIT_PAGADO'
  | 'KIT_PENDIENTE'
  | 'PRUEBA'
  | 'SIN_TALLA'
  | 'SIN_CORREO';
export const FILTRO_CLASE_LABEL: Record<FiltroClase, string> = {
  TODOS: 'Todas',
  POR_LLEGAR: 'Por llegar',
  PRESENTES: 'Presentes',
  KIT_PAGADO: 'Kit pagado',
  KIT_PENDIENTE: 'Kit pendiente',
  PRUEBA: 'Clase de prueba',
  SIN_TALLA: 'Sin talla',
  SIN_CORREO: 'Sin correo',
};

export type OrdenClase = 'ALUMNA' | 'APODERADO' | 'ESTADO' | 'REGISTRO';
export const ORDEN_CLASE_LABEL: Record<OrdenClase, string> = {
  ALUMNA: 'Alumna (A-Z)',
  APODERADO: 'Apoderado (A-Z)',
  ESTADO: 'Estado de pago (pendientes primero)',
  REGISTRO: 'Fecha de registro',
};

export function normalizar(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function kitPagado(i: ItemPrimeraClase): boolean {
  return i.caso.estado === 'INSCRITO';
}

/** `presente`: si está marcado en la asistencia de su fecha (solo lo usan Por llegar y Presentes). */
export function cumpleFiltro(
  i: ItemPrimeraClase,
  filtro: FiltroClase,
  talla: string | null | undefined,
  presente = false,
): boolean {
  switch (filtro) {
    case 'POR_LLEGAR':
      return !presente;
    case 'PRESENTES':
      return presente;
    case 'KIT_PAGADO':
      return kitPagado(i);
    case 'KIT_PENDIENTE':
      return i.tipo === 'INSCRIPCION' && !kitPagado(i);
    case 'PRUEBA':
      return i.tipo === 'PRUEBA';
    case 'SIN_TALLA':
      return !talla;
    case 'SIN_CORREO':
      return !i.caso.atleta.apoderado.email?.trim();
    default:
      return true;
  }
}

export function cumpleBusqueda(i: ItemPrimeraClase, texto: string): boolean {
  const q = normalizar(texto);
  if (!q) return true;
  const a = i.caso.atleta;
  const donde = normalizar(
    [a.nombre, a.apellidos, a.apoderado.nombre, a.apoderado.apellidos, a.apoderado.telefono, a.apoderado.email].join(' '),
  );
  return q.split(' ').every((p) => donde.includes(p));
}

const nombreAlumna = (i: ItemPrimeraClase) => `${i.caso.atleta.nombre} ${i.caso.atleta.apellidos}`;
const nombreApoderado = (i: ItemPrimeraClase) => `${i.caso.atleta.apoderado.nombre} ${i.caso.atleta.apoderado.apellidos}`;
/** Pendientes de pago primero, luego clases de prueba, luego pagadas. */
const rangoEstado = (i: ItemPrimeraClase) => (i.tipo === 'INSCRIPCION' && !kitPagado(i) ? 0 : i.tipo === 'PRUEBA' ? 1 : 2);

export function ordenarItems(items: ItemPrimeraClase[], orden: OrdenClase): ItemPrimeraClase[] {
  const porAlumna = (a: ItemPrimeraClase, b: ItemPrimeraClase) => nombreAlumna(a).localeCompare(nombreAlumna(b), 'es');
  const copia = [...items];
  switch (orden) {
    case 'APODERADO':
      return copia.sort((a, b) => nombreApoderado(a).localeCompare(nombreApoderado(b), 'es') || porAlumna(a, b));
    case 'ESTADO':
      return copia.sort((a, b) => rangoEstado(a) - rangoEstado(b) || porAlumna(a, b));
    case 'REGISTRO':
      return copia.sort((a, b) => a.caso.created_at.localeCompare(b.caso.created_at));
    default:
      return copia.sort(porAlumna);
  }
}

// ---------------------------------------------------------------------------
// Lista de asistencia

export interface FilaAsistencia {
  n: number;
  alumna: string;
  edad: number | null;
  fechaNacimiento: string;
  talla: string;
  tipo: string;
  pago: string;
  apoderado: string;
  relacion: string;
  telefono: string;
  email: string;
  nota: string;
}

function tipoItem(i: ItemPrimeraClase): string {
  if (i.tipo === 'INSCRIPCION') return 'Inscripción Star';
  return i.caso.journey === 'CLASE_PRUEBA_STAR' ? 'Prueba Star' : 'Clase de prueba';
}

/** Filas ordenadas por alumna; la edad es la que tiene el día de la clase. */
export function filasAsistencia(items: ItemPrimeraClase[], tallas: Map<string, string | null>, fechaClase: string): FilaAsistencia[] {
  const dia = new Date(`${fechaClase}T12:00:00Z`);
  return ordenarItems(items, 'ALUMNA').map((i, idx) => {
    const a = i.caso.atleta;
    return {
      n: idx + 1,
      alumna: `${a.nombre} ${a.apellidos}`.trim(),
      edad: calcularEdad(a.fecha_nacimiento, dia)?.edad ?? null,
      fechaNacimiento: a.fecha_nacimiento,
      talla: tallas.get(a.id) ?? '',
      tipo: tipoItem(i),
      pago: i.tipo === 'INSCRIPCION' ? (kitPagado(i) ? 'Kit pagado' : 'Kit pendiente') : kitPagado(i) ? 'Inscrita' : '',
      apoderado: `${a.apoderado.nombre} ${a.apoderado.apellidos}`.trim(),
      relacion: RELACION_APODERADO_LABEL[a.apoderado.relacion] ?? a.apoderado.relacion ?? '',
      telefono: a.apoderado.telefono,
      email: a.apoderado.email ?? '',
      nota: i.caso.comentario_inicial ?? '',
    };
  });
}

const COLUMNAS_CSV: Array<[string, (f: FilaAsistencia) => string]> = [
  ['N°', (f) => String(f.n)],
  ['Alumna', (f) => f.alumna],
  ['Edad', (f) => (f.edad === null ? '' : String(f.edad))],
  ['Fecha de nacimiento', (f) => f.fechaNacimiento],
  ['Talla polera', (f) => f.talla],
  ['Tipo', (f) => f.tipo],
  ['Pago', (f) => f.pago],
  ['Apoderado', (f) => f.apoderado],
  ['Relación', (f) => f.relacion],
  ['Teléfono', (f) => f.telefono],
  ['Correo', (f) => f.email],
  ['Nota', (f) => f.nota],
  ['Asistió', () => ''],
];

function celdaCsv(v: string): string {
  // Evita que Excel interprete un texto como fórmula.
  const seguro = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV para Excel en español: separador ";" y BOM para que respete tildes. */
export function csvAsistencia(filas: FilaAsistencia[]): string {
  const lineas = [COLUMNAS_CSV.map(([t]) => t), ...filas.map((f) => COLUMNAS_CSV.map(([, v]) => v(f)))];
  return `﻿${lineas.map((l) => l.map(celdaCsv).join(';')).join('\r\n')}\r\n`;
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Página imprimible (o para guardar como PDF) para pasar lista. */
export function htmlAsistencia(titulo: string, subtitulo: string, filas: FilaAsistencia[]): string {
  const cuerpo = filas
    .map(
      (f) => `<tr>
        <td class="n">${f.n}</td>
        <td><strong>${esc(f.alumna)}</strong><div class="sub">${f.edad === null ? '' : `${f.edad} años`}${f.talla ? ` · talla ${esc(f.talla)}` : ''}</div></td>
        <td>${esc(f.tipo)}${f.pago ? `<div class="sub${f.pago === 'Kit pendiente' ? ' pend' : ''}">${esc(f.pago)}</div>` : ''}</td>
        <td>${esc(f.apoderado)}${f.relacion ? `<div class="sub">${esc(f.relacion)}</div>` : ''}</td>
        <td class="tel">${esc(f.telefono)}</td>
        <td class="caja"><span></span></td>
        <td class="obs">${esc(f.nota)}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#171412;margin:24px;background:#fff}
  h1{font-size:20px;margin:0} p.sub-t{margin:4px 0 16px;color:#6B6259;font-size:13px}
  .acciones{margin:0 0 16px} .acciones button{font:inherit;font-size:14px;padding:8px 16px;border-radius:8px;border:1px solid #171412;background:#171412;color:#fff;cursor:pointer}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6B6259;border-bottom:2px solid #171412;padding:6px}
  td{border-bottom:1px solid #D9D3CA;padding:7px 6px;vertical-align:top}
  td.n{width:28px;color:#6B6259} td.tel{white-space:nowrap} .sub{color:#6B6259;font-size:11px;margin-top:2px} .sub.pend{color:#A15C00;font-weight:bold}
  td.caja span{display:inline-block;width:20px;height:20px;border:1.5px solid #171412;border-radius:4px}
  td.obs{width:22%;color:#6B6259;font-size:11px} tr{page-break-inside:avoid}
  .pie{margin-top:14px;font-size:11px;color:#6B6259}
  @media print{ body{margin:12mm} .acciones{display:none} @page{size:A4 landscape;margin:10mm} }
</style></head><body>
<h1>${esc(titulo)}</h1>
<p class="sub-t">${esc(subtitulo)}</p>
<div class="acciones"><button type="button" onclick="window.print()">Imprimir o guardar como PDF</button></div>
<table><thead><tr><th>#</th><th>Alumna</th><th>Tipo</th><th>Apoderado</th><th>Teléfono</th><th>Asistió</th><th>Observaciones</th></tr></thead>
<tbody>${cuerpo}</tbody></table>
<p class="pie">${filas.length} ${filas.length === 1 ? 'alumna' : 'alumnas'} · Firehouse Cheerleading All Stars</p>
</body></html>`;
}
