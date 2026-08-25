// Utilidades de formato compartidas entre el dashboard y la ficha del CRM.

import { CRM_ESTADOS, ESTADOS_CERRADOS } from './constants.ts';

const ZONA = 'America/Santiago';

export function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatearFechaHora(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Para el <input type="datetime-local"> del selector de fecha de próxima acción. */
export function aFechaLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function claseBadgeEstado(estado: string): string {
  if (estado === CRM_ESTADOS.INSCRITO) return 'admin-badge--estado-cerrado-ok';
  if (ESTADOS_CERRADOS.includes(estado)) return 'admin-badge--estado-cerrado-no';
  return 'admin-badge--estado-abierto';
}
