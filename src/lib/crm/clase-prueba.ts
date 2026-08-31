// Fechas de clase de prueba. Firehouse entrena viernes (Cheer) y sábado (Gimnasia),
// así que "elegir un día" no necesita un calendario configurable — se calculan solas
// las próximas fechas disponibles. Puro y sin dependencias: corre igual en el
// navegador (para mostrar el selector) y en la Cloudflare Function (para validar).

export type TipoSesionPrueba = 'CHEER' | 'GIMNASIA';

function formatearFechaLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parsearFechaLocal(fechaISO: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return null;
  const [y, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) return null;
  return fecha;
}

export function tipoSesionPrueba(fechaISO: string): TipoSesionPrueba | null {
  const fecha = parsearFechaLocal(fechaISO);
  if (!fecha) return null;
  const dia = fecha.getDay(); // 0=domingo … 5=viernes, 6=sábado
  if (dia === 5) return 'CHEER';
  if (dia === 6) return 'GIMNASIA';
  return null;
}

/** Las próximas N fechas disponibles (viernes o sábado), empezando mañana. */
export function proximasFechasClasePrueba(cantidad: number, ahora: Date = new Date()): string[] {
  const fechas: string[] = [];
  const cursor = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  let vueltas = 0;
  while (fechas.length < cantidad && vueltas < 60) {
    const dia = cursor.getDay();
    if (dia === 5 || dia === 6) fechas.push(formatearFechaLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
    vueltas += 1;
  }
  return fechas;
}

/** Fuente de verdad server-side: sólo aceptamos un viernes o sábado futuro. */
export function esFechaClasePruebaValida(fechaISO: string, ahora: Date = new Date()): boolean {
  const fecha = parsearFechaLocal(fechaISO);
  if (!fecha) return false;
  const dia = fecha.getDay();
  if (dia !== 5 && dia !== 6) return false;
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  return fecha.getTime() >= manana.getTime();
}

const LABEL_TIPO: Record<TipoSesionPrueba, string> = { CHEER: 'Cheer', GIMNASIA: 'Gimnasia' };

/** "Viernes 5 sep (Cheer)" — para el selector del formulario y para mostrar en el CRM. */
export function etiquetaFechaClasePrueba(fechaISO: string): string {
  const fecha = parsearFechaLocal(fechaISO);
  if (!fecha) return fechaISO;
  const texto = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'short' }).format(fecha);
  const capitalizado = texto.charAt(0).toUpperCase() + texto.slice(1);
  const tipo = tipoSesionPrueba(fechaISO);
  return tipo ? `${capitalizado} (${LABEL_TIPO[tipo]})` : capitalizado;
}
