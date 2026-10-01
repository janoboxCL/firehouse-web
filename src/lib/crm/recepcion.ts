// Modo Recepción de Clase de hoy: encontrar rápido a quien llega, en el
// celular, escribiendo pocas letras o tocando la inicial. Lógica pura, sin DOM.

import { normalizar } from './clase-prueba-lista.ts';

export interface PersonaRecepcion {
  /** atleta_id */
  id: string;
  nombre: string;
  apellidos: string;
  /** Nombre del apoderado/a, para distinguir a dos niños con el mismo nombre. */
  apoderado: string;
}

export type ModoRecepcion = 'POR_LLEGAR' | 'LLEGARON' | 'TODOS';

export interface FiltroRecepcion {
  texto: string;
  /** Inicial del nombre (A-Z), o null para todas. */
  letra: string | null;
  modo: ModoRecepcion;
  presentes: Set<string>;
}

/** Inicial del nombre sin tildes, en mayúscula ("Ámbar" → "A"). */
export function inicial(nombre: string): string {
  return normalizar(nombre).charAt(0).toUpperCase();
}

/** Iniciales presentes en la lista, ordenadas, para la fila de letras. */
export function letrasDisponibles(personas: PersonaRecepcion[]): string[] {
  return [...new Set(personas.map((p) => inicial(p.nombre)).filter((l) => /[A-Z]/.test(l)))].sort();
}

function cumpleModo(p: PersonaRecepcion, modo: ModoRecepcion, presentes: Set<string>): boolean {
  if (modo === 'POR_LLEGAR') return !presentes.has(p.id);
  if (modo === 'LLEGARON') return presentes.has(p.id);
  return true;
}

/**
 * Filtra y ordena. Con texto, primero quienes tienen un nombre o apellido que
 * empieza con lo escrito ("isi" → Isidora antes que Luisina); luego el resto
 * de coincidencias (también por nombre del apoderado). Sin texto, por nombre.
 */
export function filtrarRecepcion(personas: PersonaRecepcion[], f: FiltroRecepcion): PersonaRecepcion[] {
  const q = normalizar(f.texto);
  const palabras = q ? q.split(' ') : [];
  const porNombre = (a: PersonaRecepcion, b: PersonaRecepcion) =>
    `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, 'es');

  const candidatos = personas.filter((p) => {
    if (!cumpleModo(p, f.modo, f.presentes)) return false;
    if (f.letra && inicial(p.nombre) !== f.letra) return false;
    if (!palabras.length) return true;
    const donde = normalizar(`${p.nombre} ${p.apellidos} ${p.apoderado}`);
    return palabras.every((w) => donde.includes(w));
  });
  if (!palabras.length) return candidatos.sort(porNombre);

  const empieza = (p: PersonaRecepcion) =>
    normalizar(`${p.nombre} ${p.apellidos}`).split(' ').some((parte) => parte.startsWith(palabras[0]));
  return candidatos.sort((a, b) => Number(empieza(b)) - Number(empieza(a)) || porNombre(a, b));
}

export function contarModos(personas: PersonaRecepcion[], presentes: Set<string>): Record<ModoRecepcion, number> {
  const llegaron = personas.filter((p) => presentes.has(p.id)).length;
  return { POR_LLEGAR: personas.length - llegaron, LLEGARON: llegaron, TODOS: personas.length };
}
