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

function partesChile(ahora: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? '';
  return { fecha: `${parte('year')}-${parte('month')}-${parte('day')}`, hora: `${parte('hour')}:${parte('minute')}` };
}

/** true si la fecha (YYYY-MM-DD) es un día de clase del calendario Star. */
export function esDiaClaseStar(fecha: string, primeraClase: string = STAR_FIRST_CLASS_DATE): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const diff = fechaUtcDesdeIso(fecha).getTime() - fechaUtcDesdeIso(primeraClase).getTime();
  return diff >= 0 && diff % MS_POR_SEMANA === 0;
}

/**
 * Retorna la próxima fecha válida del calendario Star. La recurrencia semanal
 * está anclada a la primera clase configurada, por lo que nunca puede producir
 * una fecha anterior al inicio del programa.
 *
 * El día de clase cuenta como "próxima" solo hasta la hora de inicio: quien se
 * inscribe un sábado después de que empezó la clase queda para el sábado
 * siguiente. Sin `horaInicio`, el día de clase siempre cuenta (regla anterior).
 */
export function getNextStarClassDate(
  ahora: Date = new Date(),
  primeraClase: string = STAR_FIRST_CLASS_DATE,
  horaInicio?: string | null,
): string {
  const primera = fechaUtcDesdeIso(primeraClase);
  const chile = partesChile(ahora);
  let hoy = fechaUtcDesdeIso(chile.fecha);
  if (horaInicio && esDiaClaseStar(chile.fecha, primeraClase) && chile.hora >= horaInicio.slice(0, 5)) {
    hoy = new Date(hoy.getTime() + MS_POR_DIA);
  }
  if (hoy.getTime() <= primera.getTime()) return primeraClase;

  const semanas = Math.ceil((hoy.getTime() - primera.getTime()) / MS_POR_SEMANA);
  return isoDesdeUtc(new Date(primera.getTime() + semanas * MS_POR_SEMANA));
}
