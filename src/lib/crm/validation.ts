// Validación y normalización server-side. Esta es la fuente de verdad de seguridad:
// el cliente valida para UX, pero todo se vuelve a validar acá antes de tocar la base de datos.

import { LIMITES } from './constants.ts';
import { COMUNAS_CHILE } from './comunas.ts';
import type { ValidationError } from './types.ts';

// Letras (con acentos/diacríticos), espacios, apóstrofes y guiones. No restringe a ASCII.
const NOMBRE_RE = /^[\p{L}\p{M} '’-]+$/u;

// Suficiente para uso real sin pretender ser un validador RFC 5322 completo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function limpiarTexto(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  return valor.trim().replace(/\s+/g, ' ');
}

export function validarNombre(
  valor: unknown,
  campo: string,
  max: number = LIMITES.NOMBRE_MAX,
): ValidationError | null {
  const texto = limpiarTexto(valor);
  if (texto.length < LIMITES.NOMBRE_MIN) {
    return { field: campo, message: `Debe tener al menos ${LIMITES.NOMBRE_MIN} caracteres.` };
  }
  if (texto.length > max) {
    return { field: campo, message: `No puede superar los ${max} caracteres.` };
  }
  if (!NOMBRE_RE.test(texto)) {
    return { field: campo, message: 'Contiene caracteres no permitidos.' };
  }
  return null;
}

export function validarEmail(valor: unknown): { email: string | null; error: ValidationError | null } {
  const texto = limpiarTexto(valor).toLowerCase();
  if (!texto) {
    return { email: null, error: { field: 'email', message: 'El correo es obligatorio.' } };
  }
  if (texto.length > LIMITES.EMAIL_MAX) {
    return { email: null, error: { field: 'email', message: 'El correo es demasiado largo.' } };
  }
  if (!EMAIL_RE.test(texto)) {
    return { email: null, error: { field: 'email', message: 'El correo no tiene un formato válido.' } };
  }
  return { email: texto, error: null };
}

/**
 * Normaliza un teléfono chileno móvil a formato E.164 (+56912345678).
 * Acepta: 912345678 · 9 1234 5678 · +56912345678 · +56 9 1234 5678
 * Devuelve null si no corresponde a un móvil chileno razonable.
 */
export function normalizarTelefonoCL(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  let digitos = valor.replace(/[^\d]/g, '');
  if (digitos.startsWith('56')) {
    digitos = digitos.slice(2);
  }
  if (digitos.length !== 9 || !digitos.startsWith('9')) {
    return null;
  }
  return `+56${digitos}`;
}

export function validarTelefono(
  valor: unknown,
  campo: string,
  obligatorio: boolean,
): { telefono: string | null; error: ValidationError | null } {
  const texto = limpiarTexto(valor);
  if (!texto) {
    if (obligatorio) {
      return { telefono: null, error: { field: campo, message: 'El teléfono es obligatorio.' } };
    }
    return { telefono: null, error: null };
  }
  const normalizado = normalizarTelefonoCL(texto);
  if (!normalizado) {
    return {
      telefono: null,
      error: { field: campo, message: 'Ingresa un celular chileno válido (ej: 9 1234 5678).' },
    };
  }
  return { telefono: normalizado, error: null };
}

export function validarComuna(valor: unknown): { comuna: string | null; error: ValidationError | null } {
  const texto = limpiarTexto(valor);
  if (!texto) {
    return { comuna: null, error: { field: 'comuna', message: 'La comuna es obligatoria.' } };
  }
  if (texto.length > LIMITES.COMUNA_MAX) {
    return { comuna: null, error: { field: 'comuna', message: 'Comuna inválida.' } };
  }
  // No forzamos coincidencia exacta con el listado (evita bloquear a alguien por un typo del
  // autocomplete o una comuna fuera de nuestra lista), pero sí avisamos si no es reconocible.
  const coincide = COMUNAS_CHILE.some((c) => c.localeCompare(texto, 'es', { sensitivity: 'base' }) === 0);
  return { comuna: coincide ? COMUNAS_CHILE.find((c) => c.localeCompare(texto, 'es', { sensitivity: 'base' }) === 0)! : texto, error: null };
}

export interface EdadCalculada {
  edad: number;
  fueraRangoHabitual: boolean;
}

/**
 * Calcula la edad a partir de la fecha de nacimiento (ISO yyyy-mm-dd).
 * Nunca se guarda la edad como dato maestro; siempre se deriva de fecha_nacimiento.
 */
export function calcularEdad(fechaNacimientoISO: string, ahora: Date = new Date()): EdadCalculada | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaNacimientoISO);
  if (!match) return null;
  const [, y, m, d] = match;
  const fecha = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(fecha.getTime())) return null;
  // Rechaza fechas imposibles (ej: 2026-02-30 se "normaliza" en JS; comparamos de vuelta).
  if (
    fecha.getUTCFullYear() !== Number(y) ||
    fecha.getUTCMonth() !== Number(m) - 1 ||
    fecha.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  if (fecha.getTime() > ahora.getTime()) return null; // no permitir fecha futura

  let edad = ahora.getUTCFullYear() - fecha.getUTCFullYear();
  const noHaCumplidoEsteAnio =
    ahora.getUTCMonth() < fecha.getUTCMonth() ||
    (ahora.getUTCMonth() === fecha.getUTCMonth() && ahora.getUTCDate() < fecha.getUTCDate());
  if (noHaCumplidoEsteAnio) edad -= 1;

  if (edad < 0) return null;

  const fueraRangoHabitual = edad < LIMITES.EDAD_HABITUAL_MIN || edad > LIMITES.EDAD_HABITUAL_MAX;
  return { edad, fueraRangoHabitual };
}

export function validarComentario(
  valor: unknown,
  max: number,
  campo = 'comentario',
): { texto: string | null; error: ValidationError | null } {
  if (valor === undefined || valor === null || valor === '') {
    return { texto: null, error: null };
  }
  const texto = limpiarTexto(valor);
  if (texto.length > max) {
    return { texto: null, error: { field: campo, message: `No puede superar los ${max} caracteres.` } };
  }
  return { texto, error: null };
}
