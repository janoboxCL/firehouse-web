// Clase de prueba: el apoderado sólo elige el día de la semana (Viernes o
// Sábado) — no una fecha exacta de un calendario. El sistema resuelve solo la
// próxima fecha concreta para que el staff sepa cuándo hacer seguimiento.
// Qué días están disponibles lo controla el mantenedor en /admin/configuracion
// (por ahora, sólo sábado).

import { DIA_CLASE_PRUEBA } from './constants.ts';

export type DiaClasePrueba = 'VIERNES' | 'SABADO';

const DOW_POR_DIA: Record<DiaClasePrueba, number> = {
  VIERNES: 5,
  SABADO: 6,
};

export interface DiasHabilitados {
  viernes: boolean;
  sabado: boolean;
}

export function esDiaClasePruebaValido(valor: unknown): valor is DiaClasePrueba {
  return valor === DIA_CLASE_PRUEBA.VIERNES || valor === DIA_CLASE_PRUEBA.SABADO;
}

export function diaEstaHabilitado(dia: DiaClasePrueba, habilitados: DiasHabilitados): boolean {
  return dia === 'VIERNES' ? habilitados.viernes : habilitados.sabado;
}

function formatearFechaLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** La próxima fecha concreta (empezando mañana) que cae en ese día de la semana. */
export function proximaFechaParaDia(dia: DiaClasePrueba, ahora: Date = new Date()): string {
  const objetivo = DOW_POR_DIA[dia];
  const cursor = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  let vueltas = 0;
  while (cursor.getDay() !== objetivo && vueltas < 14) {
    cursor.setDate(cursor.getDate() + 1);
    vueltas += 1;
  }
  return formatearFechaLocal(cursor);
}

const LABEL_DIA: Record<DiaClasePrueba, string> = { VIERNES: 'Viernes', SABADO: 'Sábado' };

export function etiquetaDia(dia: DiaClasePrueba): string {
  return LABEL_DIA[dia] ?? dia;
}
