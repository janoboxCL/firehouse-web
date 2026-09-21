/** Configuración central del calendario de clases Firehouse Star. */
export const STAR_FIRST_CLASS_DATE = '2026-10-03';
export const STAR_CLASS_START = '18:30';
export const STAR_CLASS_END = '20:00';

const MS_POR_DIA = 86_400_000;
const MS_POR_SEMANA = 7 * MS_POR_DIA;

function fechaUtcDesdeIso(fecha: string): Date {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDesdeUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Retorna la próxima fecha válida del calendario Star (incluye el día actual).
 * La recurrencia semanal está anclada a la primera clase configurada, por lo
 * que nunca puede producir una fecha anterior al inicio del programa.
 */
export function getNextStarClassDate(ahora: Date = new Date()): string {
  const primera = fechaUtcDesdeIso(STAR_FIRST_CLASS_DATE);
  const partesChile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partesChile.find((p) => p.type === tipo)?.value ?? '';
  const fechaChile = `${parte('year')}-${parte('month')}-${parte('day')}`;
  const hoy = fechaUtcDesdeIso(fechaChile);
  if (hoy.getTime() <= primera.getTime()) return STAR_FIRST_CLASS_DATE;

  const semanas = Math.ceil((hoy.getTime() - primera.getTime()) / MS_POR_SEMANA);
  return isoDesdeUtc(new Date(primera.getTime() + semanas * MS_POR_SEMANA));
}
