// Configuración de la academia (migración 0012): horario Firehouse Star,
// horarios de clase de prueba, cobros y tallas. Lógica pura: tipos, valores
// de respaldo, normalización y validación. La usan el panel, las Functions y
// las páginas públicas.

import { STAR_CLASS_END, STAR_CLASS_START, STAR_FIRST_CLASS_DATE } from './star-class.ts';
import { DIA_VENCIMIENTO, PRORRATEO_SEMANA } from './cuenta.ts';

export interface ConfigAcademia {
  starPrimeraClase: string; // YYYY-MM-DD
  starHoraInicio: string; // HH:MM
  starHoraFin: string; // HH:MM
  diaVencimiento: number; // 1..28
  prorrateo: number[]; // 4 porcentajes, semana 1..4
  tallas: string[];
}

export interface HorarioClasePrueba {
  dia: 'VIERNES' | 'SABADO';
  habilitado: boolean;
  disciplina: string | null;
  horaInicio: string | null;
  horaFin: string | null;
}

export const TALLAS_RESPALDO = ['4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL'];

export const CONFIG_RESPALDO: ConfigAcademia = {
  starPrimeraClase: STAR_FIRST_CLASS_DATE,
  starHoraInicio: STAR_CLASS_START,
  starHoraFin: STAR_CLASS_END,
  diaVencimiento: DIA_VENCIMIENTO,
  prorrateo: [...PRORRATEO_SEMANA],
  tallas: TALLAS_RESPALDO,
};

/** "18:30:00" → "18:30". */
export function horaCorta(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Fila de configuracion_academia → ConfigAcademia, con respaldo campo a campo. */
export function configDesdeFila(fila: Record<string, unknown> | null | undefined): ConfigAcademia {
  if (!fila) return { ...CONFIG_RESPALDO };
  const prorrateo = Array.isArray(fila.cobro_prorrateo) && fila.cobro_prorrateo.length === 4
    ? fila.cobro_prorrateo.map(Number)
    : [...PRORRATEO_SEMANA];
  const tallas = Array.isArray(fila.tallas_polera) && fila.tallas_polera.length > 0
    ? fila.tallas_polera.map(String)
    : TALLAS_RESPALDO;
  return {
    starPrimeraClase: typeof fila.star_primera_clase === 'string' ? fila.star_primera_clase : STAR_FIRST_CLASS_DATE,
    starHoraInicio: horaCorta(fila.star_hora_inicio) ?? STAR_CLASS_START,
    starHoraFin: horaCorta(fila.star_hora_fin) ?? STAR_CLASS_END,
    diaVencimiento: Number(fila.cobro_dia_vencimiento) || DIA_VENCIMIENTO,
    prorrateo,
    tallas,
  };
}

export function filaDesdeConfig(c: ConfigAcademia): Record<string, unknown> {
  return {
    star_primera_clase: c.starPrimeraClase,
    star_hora_inicio: c.starHoraInicio,
    star_hora_fin: c.starHoraFin,
    cobro_dia_vencimiento: c.diaVencimiento,
    cobro_prorrateo: c.prorrateo,
    tallas_polera: c.tallas,
  };
}

export function horarioDesdeFila(fila: Record<string, unknown>): HorarioClasePrueba {
  return {
    dia: fila.dia === 'VIERNES' ? 'VIERNES' : 'SABADO',
    habilitado: fila.habilitado === true,
    disciplina: typeof fila.disciplina === 'string' && fila.disciplina.trim() ? fila.disciplina.trim() : null,
    horaInicio: horaCorta(fila.hora_inicio),
    horaFin: horaCorta(fila.hora_fin),
  };
}

/** "Gimnasia, 16:00–18:00" (o lo que haya disponible). */
export function textoHorario(h: Pick<HorarioClasePrueba, 'disciplina' | 'horaInicio' | 'horaFin'>): string {
  const horas = h.horaInicio && h.horaFin ? `${h.horaInicio}–${h.horaFin}` : h.horaInicio ?? '';
  return [h.disciplina, horas].filter(Boolean).join(', ');
}

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esHora(v: unknown): v is string {
  return typeof v === 'string' && HORA_RE.test(v);
}

export function nombreDiaSemana(fechaISO: string): string {
  return new Intl.DateTimeFormat('es-CL', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${fechaISO}T12:00:00Z`));
}

/** Tallas escritas separadas por coma, sin repetir y en el orden dado. */
export function parsearTallas(texto: string): string[] {
  const vistas = new Set<string>();
  const tallas: string[] = [];
  for (const t of texto.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (!vistas.has(t)) {
      vistas.add(t);
      tallas.push(t);
    }
  }
  return tallas;
}

export type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string };

export function validarConfig(c: ConfigAcademia): Validacion<ConfigAcademia> {
  if (!FECHA_RE.test(c.starPrimeraClase) || Number.isNaN(Date.parse(`${c.starPrimeraClase}T12:00:00Z`))) {
    return { ok: false, error: 'Indica la fecha de la primera clase Star.' };
  }
  if (!esHora(c.starHoraInicio) || !esHora(c.starHoraFin)) return { ok: false, error: 'Revisa el horario de Firehouse Star (formato HH:MM).' };
  if (c.starHoraFin <= c.starHoraInicio) return { ok: false, error: 'La hora de término de Star debe ser posterior a la de inicio.' };
  if (!Number.isInteger(c.diaVencimiento) || c.diaVencimiento < 1 || c.diaVencimiento > 28) {
    return { ok: false, error: 'El día de vencimiento debe estar entre 1 y 28.' };
  }
  if (c.prorrateo.length !== 4 || c.prorrateo.some((p) => !Number.isInteger(p) || p < 0 || p > 100)) {
    return { ok: false, error: 'Cada porcentaje de prorrateo debe ser un número entero entre 0 y 100.' };
  }
  if (c.tallas.length === 0 || c.tallas.length > 30 || c.tallas.some((t) => t.length > 10)) {
    return { ok: false, error: 'Indica entre 1 y 30 tallas, de hasta 10 caracteres cada una.' };
  }
  return { ok: true, valor: c };
}

export function validarHorario(h: HorarioClasePrueba): Validacion<HorarioClasePrueba> {
  if (h.horaInicio && !esHora(h.horaInicio)) return { ok: false, error: `Revisa la hora de inicio del ${h.dia.toLowerCase()}.` };
  if (h.horaFin && !esHora(h.horaFin)) return { ok: false, error: `Revisa la hora de término del ${h.dia.toLowerCase()}.` };
  if (h.horaInicio && h.horaFin && h.horaFin <= h.horaInicio) {
    return { ok: false, error: `En ${h.dia === 'VIERNES' ? 'viernes' : 'sábado'}, la hora de término debe ser posterior a la de inicio.` };
  }
  if (h.habilitado && !h.horaInicio) return { ok: false, error: `Para ofrecer el ${h.dia === 'VIERNES' ? 'viernes' : 'sábado'}, indica su hora de inicio.` };
  if (h.disciplina && h.disciplina.length > 40) return { ok: false, error: 'La disciplina puede tener hasta 40 caracteres.' };
  return { ok: true, valor: h };
}

/** Montos de la mensualidad por semana de ingreso, para mostrar al público. */
export function montosProrrateo(mensualidad: number, prorrateo: number[]): number[] {
  return prorrateo.map((p) => Math.round((mensualidad * p) / 100));
}
