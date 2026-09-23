// Programas de Firehouse (All Star competitivo y Firehouse Star), sus precios por
// temporada y sus periodos de inscripción. Lógica pura: sin Supabase, testeable
// con node --test. La base de datos (migración 0007) replica las mismas reglas.
//
// Conceptos:
// - Programa: la línea comercial (ALL_STAR o STAR). Es independiente del journey
//   y de la etapa del caso.
// - Periodo de inscripción: cuándo se puede inscribir alguien en un programa.
//   Es distinto de cuándo empiezan las clases (clases_inician).
// - Precio hermanos: precio total mensual para dos hermanos, según la
//   combinación de programas.

export const PROGRAMAS = {
  ALL_STAR: 'ALL_STAR',
  STAR: 'STAR',
} as const;

export type Programa = (typeof PROGRAMAS)[keyof typeof PROGRAMAS];

export const PROGRAMAS_LABEL: Record<Programa, string> = {
  ALL_STAR: 'Firehouse All Star',
  STAR: 'Firehouse Star',
};

export const COMBINACIONES_HERMANOS = ['ALL_STAR+ALL_STAR', 'STAR+STAR', 'ALL_STAR+STAR'] as const;
export type CombinacionHermanos = (typeof COMBINACIONES_HERMANOS)[number];

export const COMBINACIONES_LABEL: Record<CombinacionHermanos, string> = {
  'ALL_STAR+ALL_STAR': 'Dos hermanos en All Star',
  'STAR+STAR': 'Dos hermanos en Star',
  'ALL_STAR+STAR': 'Uno en All Star y uno en Star',
};

export function esPrograma(v: unknown): v is Programa {
  return v === PROGRAMAS.ALL_STAR || v === PROGRAMAS.STAR;
}

/** Combinación canónica (orden alfabético), igual a la que guarda la base de datos. */
export function combinacionHermanos(a: Programa, b: Programa): CombinacionHermanos {
  return [a, b].sort().join('+') as CombinacionHermanos;
}

/**
 * Programa que se deduce del journey histórico. Debe coincidir con
 * fn_programa_desde_journey() de la migración 0007.
 * CLASE_PRUEBA, PRETEMPORADA y POR_CLASIFICAR quedan sin programa y se asignan a
 * mano: CLASE_PRUEBA es ambiguo porque la visita rápida (walk-in) lo usa también
 * para las clases de prueba de los sábados, que hoy son de Star.
 */
export function programaDesdeJourney(journey: string | null | undefined): Programa | null {
  switch (journey) {
    case 'RENOVACION_2027':
    case 'EXPERIMENTADA_2027':
    case 'PRINCIPIANTE_2027':
      return PROGRAMAS.ALL_STAR;
    case 'CLASE_PRUEBA_STAR':
    case 'FIREHOUSE_STAR':
      return PROGRAMAS.STAR;
    default:
      return null;
  }
}

export type SegmentoCaso = 'CONFIRMADO' | 'RECONTACTABLE' | 'ARCHIVADO';

/** Tres grupos para trabajar los casos antiguos. Igual a la vista v_casos_segmento. */
export function segmentoCaso(estado: string): SegmentoCaso {
  if (estado === 'INSCRITO') return 'CONFIRMADO';
  if (estado === 'NO_INTERESADO' || estado === 'NO_CONTINUA') return 'ARCHIVADO';
  return 'RECONTACTABLE';
}

// ---------------------------------------------------------------------------
// Periodos de inscripción
// ---------------------------------------------------------------------------

export interface PeriodoInscripcion {
  id?: string;
  programa_codigo: Programa;
  nombre: string;
  abre: string; // YYYY-MM-DD
  cierra: string | null; // null = sin fecha de cierre
  clases_inician: string | null;
  activo: boolean;
}

export type EstadoPeriodo = 'ABIERTO' | 'PROXIMO' | 'FINALIZADO' | 'INACTIVO';

export const ESTADO_PERIODO_LABEL: Record<EstadoPeriodo, string> = {
  ABIERTO: 'Abierto',
  PROXIMO: 'Próximo',
  FINALIZADO: 'Finalizado',
  INACTIVO: 'Desactivado',
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaValida(v: unknown): v is string {
  if (typeof v !== 'string' || !FECHA_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Fecha de hoy en Chile (YYYY-MM-DD), independiente de la zona del navegador o servidor. */
export function hoyChile(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(ahora);
}

export function estadoPeriodo(p: PeriodoInscripcion, hoy: string): EstadoPeriodo {
  if (!p.activo) return 'INACTIVO';
  if (hoy < p.abre) return 'PROXIMO';
  if (p.cierra !== null && hoy > p.cierra) return 'FINALIZADO';
  return 'ABIERTO';
}

export interface EstadoInscripcionPrograma {
  abierta: boolean;
  periodoActual: PeriodoInscripcion | null;
  proximo: PeriodoInscripcion | null;
}

/** ¿Está abierta la inscripción de un programa hoy? Y si no, ¿cuál es el próximo periodo? */
export function estadoInscripcionPrograma(
  periodos: PeriodoInscripcion[],
  programa: Programa,
  hoy: string,
): EstadoInscripcionPrograma {
  const delPrograma = periodos.filter((p) => p.programa_codigo === programa);
  const abiertos = delPrograma.filter((p) => estadoPeriodo(p, hoy) === 'ABIERTO').sort((a, b) => a.abre.localeCompare(b.abre));
  const proximos = delPrograma.filter((p) => estadoPeriodo(p, hoy) === 'PROXIMO').sort((a, b) => a.abre.localeCompare(b.abre));
  return {
    abierta: abiertos.length > 0,
    periodoActual: abiertos[0] ?? null,
    proximo: proximos[0] ?? null,
  };
}

/** Pares de periodos activos del mismo programa cuyas fechas se superponen (solo advertencia). */
export function periodosSolapados(periodos: PeriodoInscripcion[]): Array<[PeriodoInscripcion, PeriodoInscripcion]> {
  const activos = periodos.filter((p) => p.activo);
  const pares: Array<[PeriodoInscripcion, PeriodoInscripcion]> = [];
  for (let i = 0; i < activos.length; i++) {
    for (let j = i + 1; j < activos.length; j++) {
      const a = activos[i];
      const b = activos[j];
      if (a.programa_codigo !== b.programa_codigo) continue;
      const finA = a.cierra ?? '9999-12-31';
      const finB = b.cierra ?? '9999-12-31';
      if (a.abre <= finB && b.abre <= finA) pares.push([a, b]);
    }
  }
  return pares;
}

export type ResultadoValidacion<T> = { ok: true; valor: T } | { ok: false; error: string };

export function validarPeriodo(entrada: Record<string, unknown>): ResultadoValidacion<PeriodoInscripcion> {
  const programa = entrada.programa_codigo;
  if (!esPrograma(programa)) return { ok: false, error: 'Selecciona un programa.' };

  const nombre = String(entrada.nombre ?? '').trim();
  if (nombre.length < 2 || nombre.length > 80) return { ok: false, error: 'El nombre debe tener entre 2 y 80 caracteres.' };

  if (!esFechaValida(entrada.abre)) return { ok: false, error: 'Indica la fecha de apertura.' };

  const cierraCruda = entrada.cierra === '' || entrada.cierra === undefined ? null : entrada.cierra;
  if (cierraCruda !== null && !esFechaValida(cierraCruda)) return { ok: false, error: 'La fecha de cierre no es válida.' };
  if (cierraCruda !== null && (cierraCruda as string) < (entrada.abre as string)) {
    return { ok: false, error: 'La fecha de cierre no puede ser anterior a la de apertura.' };
  }

  const clasesCrudas = entrada.clases_inician === '' || entrada.clases_inician === undefined ? null : entrada.clases_inician;
  if (clasesCrudas !== null && !esFechaValida(clasesCrudas)) return { ok: false, error: 'La fecha de inicio de clases no es válida.' };

  return {
    ok: true,
    valor: {
      programa_codigo: programa,
      nombre,
      abre: entrada.abre as string,
      cierra: cierraCruda as string | null,
      clases_inician: clasesCrudas as string | null,
      activo: entrada.activo !== false,
    },
  };
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

export const MONTO_MAXIMO = 1_000_000;

/** Acepta "30000", "30.000" o "$30.000". Devuelve null si no es un monto válido. */
export function parsearMonto(v: unknown): number | null {
  const texto = String(v ?? '').replace(/[$.\s]/g, '');
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n <= MONTO_MAXIMO ? n : null;
}

export function formatoPesos(n: number): string {
  return `$${n.toLocaleString('es-CL')}`;
}

export function esTemporadaValida(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 2025 && (v as number) <= 2100;
}
