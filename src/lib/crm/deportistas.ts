// Deportistas, asistencia por sesión y estadísticas. Lógica pura, sin DOM.
//
// Una fila por deportista (atleta). Si un deportista tiene varios casos (por
// ejemplo, una clase de prueba y luego la inscripción Star), la fila toma el
// caso principal: Star > All Star > Clase de prueba > otro; a igual programa,
// el más reciente.

import type { CasoResumen } from './admin-api.ts';
import { COMO_CONOCIO_LABEL, CRM_ESTADOS, CRM_ESTADOS_LABEL, CRM_JOURNEYS } from './constants.ts';
import { esDiaClaseStar, getNextStarClassDate } from './star-class.ts';
import { calcularEdad } from './validation.ts';
import { normalizar } from './clase-prueba-lista.ts';

export type Programa = 'STAR' | 'ALL_STAR' | 'PRUEBA' | 'OTRO';
export const PROGRAMA_LABEL: Record<Programa, string> = {
  STAR: 'Star',
  ALL_STAR: 'All Star',
  PRUEBA: 'Clase de prueba',
  OTRO: 'Sin programa',
};
const PRIORIDAD: Record<Programa, number> = { STAR: 0, ALL_STAR: 1, PRUEBA: 2, OTRO: 3 };

export interface RegistroAsistencia {
  atleta_id: string;
  fecha: string;
}

export type Kit = 'PAGADO' | 'PENDIENTE' | null;

export interface FilaDeportista {
  atletaId: string;
  casoId: string;
  nombre: string;
  edad: number | null;
  programa: Programa;
  estado: string;
  estadoTexto: string;
  activo: boolean;
  apoderadoId: string;
  apoderado: string;
  telefono: string;
  email: string;
  comuna: string;
  comoConocio: string;
  /** Fecha (YYYY-MM-DD, Chile) en que se registró el caso principal. */
  ingreso: string;
  /** Primera clase agendada (Star o clase de prueba). */
  primeraClase: string | null;
  /** Última fecha con asistencia grabada. */
  ultimaClase: string | null;
  asistidas: number;
  esperadas: number;
  /** Alumna Star activa que faltó a las dos últimas sesiones que le correspondían. */
  faltaSeguidas: boolean;
  kit: Kit;
  fechasAsistidas: string[];
}

const ESTADOS_RETIRADOS: readonly string[] = [CRM_ESTADOS.NO_CONTINUA, CRM_ESTADOS.NO_INTERESADO];

export function programaDe(caso: Pick<CasoResumen, 'journey' | 'programa'>): Programa {
  if (caso.journey === CRM_JOURNEYS.FIREHOUSE_STAR) return 'STAR';
  if (caso.journey === CRM_JOURNEYS.CLASE_PRUEBA || caso.journey === CRM_JOURNEYS.CLASE_PRUEBA_STAR) return 'PRUEBA';
  if (caso.programa === 'ALL_STAR') return 'ALL_STAR';
  if (caso.programa === 'STAR') return 'STAR';
  return 'OTRO';
}

/** Fecha YYYY-MM-DD en Chile de un instante ISO. */
export function fechaChile(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

function casoPrincipal(casos: CasoResumen[]): CasoResumen {
  return [...casos].sort(
    (a, b) => PRIORIDAD[programaDe(a)] - PRIORIDAD[programaDe(b)] || b.created_at.localeCompare(a.created_at),
  )[0];
}

export interface OpcionesFilas {
  /** Hoy en Chile (YYYY-MM-DD). */
  hoy: string;
  primeraClaseStar?: string;
}

/** Sesiones Star en que se tomó asistencia (fechas con registros que son día de clase Star), en orden. */
export function sesionesStar(asistencias: RegistroAsistencia[], primeraClaseStar?: string): string[] {
  return [...new Set(asistencias.map((a) => a.fecha))].filter((f) => esDiaClaseStar(f, primeraClaseStar)).sort();
}

export function construirFilas(casos: CasoResumen[], asistencias: RegistroAsistencia[], op: OpcionesFilas): FilaDeportista[] {
  const porAtleta = new Map<string, CasoResumen[]>();
  for (const c of casos) {
    if (!c.atleta) continue;
    const lista = porAtleta.get(c.atleta.id) ?? [];
    lista.push(c);
    porAtleta.set(c.atleta.id, lista);
  }
  const asistidasPorAtleta = new Map<string, Set<string>>();
  for (const a of asistencias) {
    const s = asistidasPorAtleta.get(a.atleta_id) ?? new Set<string>();
    s.add(a.fecha);
    asistidasPorAtleta.set(a.atleta_id, s);
  }
  const sesiones = sesionesStar(asistencias, op.primeraClaseStar).filter((f) => f <= op.hoy);
  const hoyFecha = new Date(`${op.hoy}T12:00:00Z`);

  const filas: FilaDeportista[] = [];
  for (const [atletaId, lista] of porAtleta) {
    const caso = casoPrincipal(lista);
    const programa = programaDe(caso);
    const atleta = caso.atleta;
    const ap = atleta.apoderado;
    const fechas = [...(asistidasPorAtleta.get(atletaId) ?? [])].sort();
    const activo = !ESTADOS_RETIRADOS.includes(caso.estado);

    let primeraClase: string | null = null;
    if (programa === 'STAR' && caso.journey === CRM_JOURNEYS.FIREHOUSE_STAR) {
      primeraClase = caso.fecha_clase_prueba ?? getNextStarClassDate(new Date(caso.created_at), op.primeraClaseStar);
    } else if (programa === 'PRUEBA') {
      primeraClase = caso.fecha_clase_prueba;
    }

    let esperadas = 0;
    let asistidas = 0;
    let faltaSeguidas = false;
    if (programa === 'STAR' && primeraClase) {
      const suyas = sesiones.filter((f) => f >= primeraClase!);
      esperadas = suyas.length;
      asistidas = suyas.filter((f) => fechas.includes(f)).length;
      const ultimas = suyas.slice(-2);
      faltaSeguidas = activo && ultimas.length === 2 && ultimas.every((f) => !fechas.includes(f));
    } else if (programa === 'PRUEBA' && primeraClase) {
      const yaFue = primeraClase < op.hoy || fechas.length > 0;
      esperadas = yaFue ? 1 : 0;
      asistidas = fechas.length > 0 ? 1 : 0;
    }

    filas.push({
      atletaId,
      casoId: caso.id,
      nombre: `${atleta.nombre} ${atleta.apellidos}`.trim(),
      edad: calcularEdad(atleta.fecha_nacimiento, hoyFecha)?.edad ?? null,
      programa,
      estado: caso.estado,
      estadoTexto: CRM_ESTADOS_LABEL[caso.estado] ?? caso.estado,
      activo,
      apoderadoId: ap.id,
      apoderado: `${ap.nombre} ${ap.apellidos}`.trim(),
      telefono: ap.telefono,
      email: ap.email ?? '',
      comuna: (ap.comuna ?? '').trim(),
      comoConocio: caso.como_conocio,
      ingreso: fechaChile(caso.created_at),
      primeraClase,
      ultimaClase: fechas.length ? fechas[fechas.length - 1] : null,
      asistidas,
      esperadas,
      faltaSeguidas,
      kit: programa === 'STAR' && caso.journey === CRM_JOURNEYS.FIREHOUSE_STAR ? (caso.estado === CRM_ESTADOS.INSCRITO ? 'PAGADO' : 'PENDIENTE') : null,
      fechasAsistidas: fechas,
    });
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Filtros y orden de la grilla

export type FiltroPrograma = 'TODOS' | Programa;
export type FiltroExtra = 'NINGUNO' | 'KIT_PENDIENTE' | 'FALTAN' | 'RETIRADOS';
export const FILTRO_EXTRA_LABEL: Record<Exclude<FiltroExtra, 'NINGUNO'>, string> = {
  KIT_PENDIENTE: 'Kit pendiente',
  FALTAN: 'Faltan 2 sábados seguidos',
  RETIRADOS: 'Retirados',
};

export type OrdenDeportistas = 'INGRESO' | 'NOMBRE' | 'ULTIMA_CLASE' | 'ASISTENCIA';
export const ORDEN_DEPORTISTAS_LABEL: Record<OrdenDeportistas, string> = {
  INGRESO: 'Ingreso más reciente',
  NOMBRE: 'Nombre (A-Z)',
  ULTIMA_CLASE: 'Última clase más reciente',
  ASISTENCIA: 'Menor asistencia primero',
};

export function cumpleExtra(f: FilaDeportista, extra: FiltroExtra): boolean {
  switch (extra) {
    case 'KIT_PENDIENTE':
      return f.activo && f.kit === 'PENDIENTE';
    case 'FALTAN':
      return f.faltaSeguidas;
    case 'RETIRADOS':
      return !f.activo;
    default:
      // Por defecto no se muestran los retirados.
      return f.activo;
  }
}

export function cumpleTexto(f: FilaDeportista, texto: string): boolean {
  const q = normalizar(texto);
  if (!q) return true;
  const donde = normalizar([f.nombre, f.apoderado, f.telefono, f.email, f.comuna].join(' '));
  return q.split(' ').every((p) => donde.includes(p));
}

export function filtrarFilas(filas: FilaDeportista[], programa: FiltroPrograma, extra: FiltroExtra, texto: string): FilaDeportista[] {
  return filas.filter((f) => (programa === 'TODOS' || f.programa === programa) && cumpleExtra(f, extra) && cumpleTexto(f, texto));
}

export function proporcion(f: Pick<FilaDeportista, 'asistidas' | 'esperadas'>): number | null {
  return f.esperadas > 0 ? f.asistidas / f.esperadas : null;
}

export function ordenarFilas(filas: FilaDeportista[], orden: OrdenDeportistas): FilaDeportista[] {
  const porNombre = (a: FilaDeportista, b: FilaDeportista) => a.nombre.localeCompare(b.nombre, 'es');
  const copia = [...filas];
  switch (orden) {
    case 'NOMBRE':
      return copia.sort(porNombre);
    case 'ULTIMA_CLASE':
      return copia.sort((a, b) => (b.ultimaClase ?? '').localeCompare(a.ultimaClase ?? '') || porNombre(a, b));
    case 'ASISTENCIA':
      return copia.sort((a, b) => (proporcion(a) ?? 2) - (proporcion(b) ?? 2) || porNombre(a, b));
    default:
      return copia.sort((a, b) => b.ingreso.localeCompare(a.ingreso) || porNombre(a, b));
  }
}

/** Asistencia baja: con al menos 2 sesiones, asistió a menos de la mitad. */
export function asistenciaBaja(f: FilaDeportista): boolean {
  const p = proporcion(f);
  return f.esperadas >= 2 && p !== null && p < 0.5;
}

// ---------------------------------------------------------------------------
// Asistencia por sesión

export interface Sesion {
  fecha: string;
  presentes: FilaDeportista[];
  ausentes: FilaDeportista[];
  esperados: number;
}

/** ¿Le correspondía venir ese día? Star activo desde su primera clase, o su clase de prueba. */
function esperadoEn(f: FilaDeportista, fecha: string, primeraClaseStar?: string): boolean {
  if (f.programa === 'STAR') return f.activo && !!f.primeraClase && f.primeraClase <= fecha && esDiaClaseStar(fecha, primeraClaseStar);
  if (f.programa === 'PRUEBA') return f.primeraClase === fecha;
  return false;
}

/** Sesiones con asistencia grabada, de la más reciente a la más antigua. */
export function construirSesiones(filas: FilaDeportista[], asistencias: RegistroAsistencia[], primeraClaseStar?: string): Sesion[] {
  const fechas = [...new Set(asistencias.map((a) => a.fecha))].sort().reverse();
  return fechas.map((fecha) => {
    const presentes = filas.filter((f) => f.fechasAsistidas.includes(fecha));
    const ausentes = filas.filter((f) => !f.fechasAsistidas.includes(fecha) && esperadoEn(f, fecha, primeraClaseStar));
    return { fecha, presentes, ausentes, esperados: presentes.length + ausentes.length };
  });
}

// ---------------------------------------------------------------------------
// Estadísticas

export interface Barra {
  etiqueta: string;
  n: number;
}

export interface Estadisticas {
  deportistas: number;
  familias: number;
  familiasConHermanos: number;
  deportistasConHermanos: number;
  edadPromedio: number | null;
  edades: Barra[];
  comunas: Barra[];
  comoConocio: Barra[];
  kitPendiente: number;
  asistenciaPromedio: number | null;
  totalAsistencias: number;
  sesiones: Array<{ fecha: string; presentes: number; esperados: number }>;
}

function contar(valores: string[]): Barra[] {
  const m = new Map<string, number>();
  valores.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()].map(([etiqueta, n]) => ({ etiqueta, n })).sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/** Las `max` más frecuentes y el resto sumado en "Otras". */
export function topConOtras(barras: Barra[], max: number, otras = 'Otras'): Barra[] {
  if (barras.length <= max) return barras;
  const resto = barras.slice(max - 1);
  return [...barras.slice(0, max - 1), { etiqueta: `${otras} (${resto.length})`, n: resto.reduce((s, b) => s + b.n, 0) }];
}

/** Estadísticas de un conjunto de deportistas (ya filtrados por programa y activos). */
export function calcularEstadisticas(filas: FilaDeportista[], sesiones: Sesion[]): Estadisticas {
  const porFamilia = new Map<string, number>();
  filas.forEach((f) => porFamilia.set(f.apoderadoId, (porFamilia.get(f.apoderadoId) ?? 0) + 1));
  const conHermanos = [...porFamilia.values()].filter((n) => n >= 2);

  const conEdad = filas.filter((f) => f.edad !== null);
  const edadPromedio = conEdad.length ? conEdad.reduce((s, f) => s + (f.edad as number), 0) / conEdad.length : null;
  const edadesMap = new Map<number, number>();
  conEdad.forEach((f) => edadesMap.set(f.edad as number, (edadesMap.get(f.edad as number) ?? 0) + 1));
  const edadesOrden = [...edadesMap.keys()].sort((a, b) => a - b);
  const edades: Barra[] = [];
  if (edadesOrden.length) {
    for (let e = edadesOrden[0]; e <= edadesOrden[edadesOrden.length - 1]; e++) edades.push({ etiqueta: String(e), n: edadesMap.get(e) ?? 0 });
  }

  const ids = new Set(filas.map((f) => f.atletaId));
  // Una alumna Star cuenta desde su primera clase Star (antes pudo venir a una clase de prueba).
  const cuenta = (f: FilaDeportista, fecha: string) =>
    ids.has(f.atletaId) && (f.programa !== 'STAR' || (!!f.primeraClase && f.primeraClase <= fecha));
  const ses = sesiones
    .map((s) => {
      const presentes = s.presentes.filter((f) => cuenta(f, s.fecha)).length;
      return { fecha: s.fecha, presentes, esperados: presentes + s.ausentes.filter((f) => cuenta(f, s.fecha)).length };
    })
    .filter((s) => s.esperados > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const sumaP = ses.reduce((s, x) => s + x.presentes, 0);
  const sumaE = ses.reduce((s, x) => s + x.esperados, 0);

  return {
    deportistas: filas.length,
    familias: porFamilia.size,
    familiasConHermanos: conHermanos.length,
    deportistasConHermanos: conHermanos.reduce((s, n) => s + n, 0),
    edadPromedio,
    edades,
    comunas: topConOtras(contar(filas.map((f) => f.comuna || 'Sin comuna')), 6),
    comoConocio: contar(filas.map((f) => COMO_CONOCIO_LABEL[f.comoConocio] ?? f.comoConocio ?? 'Otro')),
    kitPendiente: filas.filter((f) => f.kit === 'PENDIENTE').length,
    asistenciaPromedio: sumaE > 0 ? sumaP / sumaE : null,
    totalAsistencias: sumaP,
    sesiones: ses,
  };
}

export interface Embudo {
  realizadas: number;
  asistieron: number;
  inscritas: number;
}

/**
 * De clase de prueba a inscripción, sobre las clases de prueba con fecha ya
 * pasada (o con asistencia grabada). Inscrita = el deportista tiene un caso
 * Firehouse Star o quedó en estado Inscrito.
 */
export function calcularEmbudo(casos: CasoResumen[], asistencias: RegistroAsistencia[], hoy: string): Embudo {
  const conAsistencia = new Set(asistencias.map((a) => a.atleta_id));
  const inscritos = new Set(
    casos.filter((c) => c.journey === CRM_JOURNEYS.FIREHOUSE_STAR || c.estado === CRM_ESTADOS.INSCRITO).map((c) => c.atleta?.id),
  );
  const pruebas = new Map<string, CasoResumen>();
  casos
    .filter((c) => programaDe(c) === 'PRUEBA' && c.fecha_clase_prueba && (c.fecha_clase_prueba < hoy || conAsistencia.has(c.atleta.id)))
    .forEach((c) => pruebas.set(c.atleta.id, c));
  const lista = [...pruebas.values()];
  const asistieron = lista.filter(
    (c) => conAsistencia.has(c.atleta.id) || c.estado === CRM_ESTADOS.ASISTIO || c.estado === CRM_ESTADOS.INSCRITO,
  );
  return {
    realizadas: lista.length,
    asistieron: asistieron.length,
    inscritas: asistieron.filter((c) => inscritos.has(c.atleta.id)).length,
  };
}

// ---------------------------------------------------------------------------
// Formatos (Chile)

export function porcentajeTexto(valor: number | null, decimales = 1): string {
  if (valor === null) return '—';
  return `${(valor * 100).toFixed(decimales).replace('.', ',')} %`;
}

export function numeroTexto(valor: number | null, decimales = 1): string {
  return valor === null ? '—' : valor.toFixed(decimales).replace('.', ',');
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "3 oct" (o "3 oct 2025" si no es del año indicado). */
export function fechaCorta(iso: string | null, anioActual?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const base = `${Number(d)} ${MESES[Number(m) - 1]}`;
  return anioActual && y !== anioActual ? `${base} ${y}` : base;
}
