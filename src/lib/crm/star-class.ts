/**
 * Calendario de clases Firehouse Star. Los valores vigentes se editan en
 * /admin/configuracion (tabla configuracion_academia, migración 0012); estas
 * constantes son solo el respaldo si la configuración no está disponible.
 */
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
export function getNextStarClassDate(ahora: Date = new Date(), primeraClase: string = STAR_FIRST_CLASS_DATE): string {
  const primera = fechaUtcDesdeIso(primeraClase);
  const partesChile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partesChile.find((p) => p.type === tipo)?.value ?? '';
  const fechaChile = `${parte('year')}-${parte('month')}-${parte('day')}`;
  const hoy = fechaUtcDesdeIso(fechaChile);
  if (hoy.getTime() <= primera.getTime()) return primeraClase;

  const semanas = Math.ceil((hoy.getTime() - primera.getTime()) / MS_POR_SEMANA);
  return isoDesdeUtc(new Date(primera.getTime() + semanas * MS_POR_SEMANA));
}
