// Registro express en Recepción (migración 0017): para quien llega sin haberse
// inscrito. Solo lo imprescindible en la puerta; el resto queda por completar.
// Lógica pura, sin DOM.

import { normalizarTelefonoCL } from './validation.ts';

export const EDADES_EXPRESS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
/** Valor del botón «No sabe» de la talla: se guarda sin talla. */
export const TALLA_NO_SABE = 'NO_SABE';

export type RelacionExpress = 'MAMA' | 'PAPA' | 'OTRO';

export interface NinoExpress {
  nombre: string;
  edad: number | null;
  /** Talla elegida, TALLA_NO_SABE o null si aún no se elige. */
  talla: string | null;
}

export interface DatosExpress {
  ninos: NinoExpress[];
  apoderadoNombre: string;
  relacion: RelacionExpress;
  /** Como lo escribe quien recibe: "9 1234 5678", "12345678" o "+56912345678". */
  telefono: string;
  consentimiento: boolean;
}

const NOMBRE_RE = /^[\p{L}\p{M} '’-]+$/u;

/** "sofía  ignacia" → "Sofía Ignacia". */
export function capitalizarNombre(texto: string): string {
  return texto
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((p) => (p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : p))
    .join(' ');
}

/** Acepta los 8 dígitos después del 9, o el número completo. */
export function telefonoExpress(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  return normalizarTelefonoCL(digitos.length === 8 ? `9${digitos}` : texto);
}

function nombreValido(texto: string): boolean {
  const t = texto.trim();
  return t.length >= 2 && t.length <= 80 && NOMBRE_RE.test(t);
}

/** Errores por campo (clave → mensaje). Vacío si todo está bien. */
export function validarExpress(d: DatosExpress): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.ninos.length === 0) e.ninos = 'Agrega al menos una niña o niño.';
  d.ninos.forEach((n, i) => {
    if (!nombreValido(n.nombre)) e[`nino-${i}-nombre`] = 'Escribe el nombre (solo letras).';
    if (n.edad === null) e[`nino-${i}-edad`] = 'Elige la edad.';
    if (n.talla === null) e[`nino-${i}-talla`] = 'Elige la talla o «No sabe».';
  });
  if (!nombreValido(d.apoderadoNombre)) e.apoderado = 'Escribe el nombre del apoderado (solo letras).';
  if (!telefonoExpress(d.telefono)) e.telefono = 'El WhatsApp debe ser un celular chileno: 9 y 8 dígitos.';
  if (!d.consentimiento) e.consentimiento = 'Confirma que autorizó el contacto.';
  return e;
}

export interface PayloadExpress {
  fecha: string;
  apoderadoId?: string;
  forzarNuevo?: boolean;
  apoderado: { nombre: string; telefono: string; relacion: RelacionExpress };
  atletas: Array<{ nombre: string; edad: number; talla: string }>;
}

/** Arma el payload de fn_registro_express. Llamar solo si validarExpress no devuelve errores. */
export function payloadExpress(d: DatosExpress, fecha: string, opciones: { apoderadoId?: string; forzarNuevo?: boolean } = {}): PayloadExpress {
  return {
    fecha,
    ...opciones,
    apoderado: { nombre: capitalizarNombre(d.apoderadoNombre), telefono: telefonoExpress(d.telefono) ?? '', relacion: d.relacion },
    atletas: d.ninos.map((n) => ({
      nombre: capitalizarNombre(n.nombre),
      edad: n.edad as number,
      talla: n.talla && n.talla !== TALLA_NO_SABE ? n.talla : '',
    })),
  };
}

export interface FamiliaExistente {
  id: string;
  nombre: string;
  atletas: string[];
}

export type ResultadoExpress =
  | { duplicado: true; existentes: FamiliaExistente[] }
  | { duplicado: false; apoderadoId: string; atletas: Array<{ atletaId: string; casoId: string; nombre: string }> };

// ---------------------------------------------------------------------------
// Datos por completar

/**
 * Qué le falta a una familia para tener su ficha completa. Se deduce de los
 * datos (no de una columna), así también cubre las visitas rápidas antiguas,
 * que guardaban "—" como apellido.
 */
export function datosPorCompletar(a: { apellidos?: string | null; apoderado: { apellidos?: string | null; email?: string | null; comuna?: string | null } }): string[] {
  const vacio = (v: string | null | undefined) => !v || !v.trim() || v.trim() === '—';
  const falta: string[] = [];
  if (vacio(a.apellidos) || vacio(a.apoderado.apellidos)) falta.push('apellidos');
  if (vacio(a.apoderado.email)) falta.push('correo');
  if (vacio(a.apoderado.comuna)) falta.push('comuna');
  return falta;
}
