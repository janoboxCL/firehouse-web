// Confirmación de datos de la familia en el link de pago (migración 0019).
// Lógica pura: la usan la página /pagar y el endpoint /api/pagar/ficha.

import { normalizarTelefonoCL } from './validation.ts';

export const RELACIONES_FICHA = ['MAMA', 'PAPA', 'TUTOR', 'OTRO'] as const;
export type RelacionFicha = (typeof RELACIONES_FICHA)[number];
export const RELACION_FICHA_LABEL: Record<RelacionFicha, string> = { MAMA: 'Mamá', PAPA: 'Papá', TUTOR: 'Tutor/a', OTRO: 'Otro' };

export interface FichaApoderado {
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string;
  comuna: string;
  relacion: string;
}

export interface FichaAtleta {
  id: string;
  nombre: string;
  apellidos: string;
  /** YYYY-MM-DD, o '' si solo se conoce la edad (registro express). */
  fechaNacimiento: string;
  /** Edad declarada en recepción, cuando la fecha es estimada. */
  edadDeclarada: number | null;
  talla: string;
}

export interface Ficha {
  confirmada: boolean;
  apoderado: FichaApoderado;
  atletas: FichaAtleta[];
}

export interface FichaValidada {
  apoderado: FichaApoderado;
  atletas: Array<{ id: string; nombre: string; apellidos: string; fechaNacimiento: string; talla: string }>;
}

export type ValidacionFicha = { ok: true; datos: FichaValidada } | { ok: false; errores: Record<string, string> };

const NOMBRE_RE = /^[\p{L}\p{M} .'’-]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function limpiar(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

function nombreOk(t: string, max: number): boolean {
  return t.length >= 2 && t.length <= max && NOMBRE_RE.test(t) && t !== '—';
}

function fechaOk(f: string, hoy: string): boolean {
  if (!FECHA_RE.test(f)) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f && f <= hoy && f >= '1940-01-01';
}

/**
 * Valida la ficha que envía la familia. `atletaIds` son los deportistas de esa
 * familia según la base: deben venir todos y ninguno ajeno.
 */
export function validarFicha(cuerpo: unknown, atletaIds: string[], hoy: string): ValidacionFicha {
  const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
  const ap = (c.apoderado && typeof c.apoderado === 'object' ? c.apoderado : {}) as Record<string, unknown>;
  const errores: Record<string, string> = {};

  const apoderado: FichaApoderado = {
    nombre: limpiar(ap.nombre),
    apellidos: limpiar(ap.apellidos),
    telefono: normalizarTelefonoCL(ap.telefono) ?? '',
    email: limpiar(ap.email).toLowerCase(),
    comuna: limpiar(ap.comuna),
    relacion: limpiar(ap.relacion),
  };
  if (!nombreOk(apoderado.nombre, 80)) errores['apoderado-nombre'] = 'Escribe tu nombre.';
  if (!nombreOk(apoderado.apellidos, 120)) errores['apoderado-apellidos'] = 'Escribe tus apellidos.';
  if (!apoderado.telefono) errores['apoderado-telefono'] = 'Escribe un celular chileno: 9 y 8 dígitos.';
  if (apoderado.email.length > 254 || !EMAIL_RE.test(apoderado.email)) errores['apoderado-email'] = 'Escribe un correo válido: ahí te enviamos los comprobantes.';
  if (apoderado.comuna.length < 2 || apoderado.comuna.length > 100) errores['apoderado-comuna'] = 'Elige tu comuna.';
  if (!(RELACIONES_FICHA as readonly string[]).includes(apoderado.relacion)) errores['apoderado-relacion'] = 'Elige tu relación con el deportista.';

  const crudos = Array.isArray(c.atletas) ? c.atletas : [];
  const atletas: FichaValidada['atletas'] = [];
  const vistos = new Set<string>();
  for (const crudo of crudos) {
    const a = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id : '';
    if (!atletaIds.includes(id) || vistos.has(id)) {
      errores.atletas = 'Los datos no corresponden a tu familia. Recarga la página.';
      continue;
    }
    vistos.add(id);
    const at = { id, nombre: limpiar(a.nombre), apellidos: limpiar(a.apellidos), fechaNacimiento: limpiar(a.fechaNacimiento), talla: limpiar(a.talla) };
    if (!nombreOk(at.nombre, 80)) errores[`atleta-${id}-nombre`] = 'Escribe el nombre.';
    if (!nombreOk(at.apellidos, 120)) errores[`atleta-${id}-apellidos`] = 'Escribe los apellidos.';
    if (!fechaOk(at.fechaNacimiento, hoy)) errores[`atleta-${id}-fecha`] = 'Indica la fecha de nacimiento.';
    if (at.talla.length > 10) errores[`atleta-${id}-talla`] = 'Elige una talla de la lista.';
    atletas.push(at);
  }
  if (vistos.size !== atletaIds.length) errores.atletas = 'Faltan datos de algún deportista. Recarga la página.';
  if (c.aceptaCondiciones !== true) errores.condiciones = 'Para continuar, acepta la política de privacidad.';

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, datos: { apoderado, atletas } };
}

/** Qué le falta a la ficha, en palabras, para mostrar un resumen antes del formulario. */
export function faltantesFicha(f: Ficha): string[] {
  const vacio = (v: string) => !v || v === '—';
  const falta: string[] = [];
  if (vacio(f.apoderado.apellidos) || f.atletas.some((a) => vacio(a.apellidos))) falta.push('apellidos');
  if (vacio(f.apoderado.email)) falta.push('correo');
  if (vacio(f.apoderado.comuna)) falta.push('comuna');
  if (f.atletas.some((a) => !a.fechaNacimiento)) falta.push('fecha de nacimiento');
  return falta;
}
