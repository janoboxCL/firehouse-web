// Cambio de fecha de una clase de prueba o de la primera clase Star.
// Lógica pura: qué fechas se pueden elegir y si una fecha es válida.

import { esDiaClaseStar } from './star-class.ts';

export type DiaClase = 'VIERNES' | 'SABADO';

export interface ReglasFecha {
  esStar: boolean;
  hoy: string; // YYYY-MM-DD en Chile
  primeraClaseStar: string;
  diasHabilitados: Record<DiaClase, boolean>;
}

const MS_DIA = 86_400_000;

function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(new Date(`${fecha}T12:00:00Z`).getTime() + dias * MS_DIA).toISOString().slice(0, 10);
}

export function validarNuevaFecha(fecha: string, r: ReglasFecha): { ok: true; dia: DiaClase } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) {
    return { ok: false, error: 'Elige una fecha válida.' };
  }
  if (fecha < r.hoy) return { ok: false, error: 'Esa fecha ya pasó.' };
  if (r.esStar) {
    if (!esDiaClaseStar(fecha, r.primeraClaseStar)) {
      return { ok: false, error: 'Firehouse Star tiene clase los sábados del calendario Star: elige uno de esos sábados.' };
    }
    return { ok: true, dia: 'SABADO' };
  }
  const d = diaSemana(fecha);
  const dia: DiaClase | null = d === 5 ? 'VIERNES' : d === 6 ? 'SABADO' : null;
  if (!dia) return { ok: false, error: 'La clase de prueba es viernes o sábado.' };
  if (!r.diasHabilitados[dia]) return { ok: false, error: `Los ${dia === 'VIERNES' ? 'viernes' : 'sábados'} no están habilitados en Configuración.` };
  return { ok: true, dia };
}

/** Próximas fechas que se pueden elegir (desde hoy), incluida la actual si sigue vigente. */
export function opcionesDeFecha(r: ReglasFecha, actual: string | null, cantidad = 6): string[] {
  const fechas: string[] = [];
  let cursor = r.hoy;
  for (let i = 0; i < 120 && fechas.length < cantidad; i++) {
    if (validarNuevaFecha(cursor, r).ok) fechas.push(cursor);
    cursor = sumarDias(cursor, 1);
  }
  if (actual && actual >= r.hoy && !fechas.includes(actual)) fechas.unshift(actual);
  return fechas.sort();
}
