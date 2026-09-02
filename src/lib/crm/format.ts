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

/**
 * Mensaje de WhatsApp sugerido para abrir la conversación con una familia recién
 * registrada. Queda precargado en el campo de texto de WhatsApp — el staff puede
 * editarlo antes de enviar, no se manda automáticamente.
 */
export function mensajeWhatsappSugerido(
  journey: string,
  estado: string,
  apoderadoNombre: string,
  atletaNombre: string,
): string {
  const nombrePila = apoderadoNombre.split(' ')[0];

  // Sólo usamos el mensaje "de bienvenida" mientras el caso sigue NUEVO — para
  // casos ya contactados un saludo genérico es más natural que repetir la
  // confirmación de registro.
  if (estado !== CRM_ESTADOS.NUEVO) {
    return `¡Hola ${nombrePila}! 👋 Te escribo de Firehouse Cheer.`;
  }

  switch (journey) {
    case 'RENOVACION_2027':
      return `¡Hola ${nombrePila}! 👋 Somos de Firehouse. Vimos que ${atletaNombre} está pensando en continuar con nosotros en 2027 y queríamos conversar contigo sobre los próximos pasos. ¿Tienes unos minutos?`;
    case 'PRETEMPORADA':
      return `¡Hola ${nombrePila}! 🔥 Recibimos el registro de ${atletaNombre} para la Pretemporada Firehouse. Queremos contarte cómo funciona y coordinar su primera clase. ¿Cuándo te acomoda conversar?`;
    case 'EXPERIMENTADA_2027':
    case 'PRINCIPIANTE_2027':
      return `¡Hola ${nombrePila}! 🔥 Recibimos el registro de ${atletaNombre} para la temporada 2027 de Firehouse. Nos encantaría conocerlos y contarte cómo es el proceso de incorporación. ¿Conversamos?`;
    default:
      return `¡Hola ${nombrePila}! 👋 Somos de Firehouse. Vimos tu registro y queremos ayudarte a encontrar la mejor opción para ${atletaNombre}. ¿Tienes unos minutos para conversar?`;
  }
}

/**
 * Extrae el mensaje real de un error de Supabase/Postgres en vez de mostrar un
 * genérico. Es un panel interno para staff — ver el error real (ej. qué
 * restricción de la base de datos bloqueó un borrado) ayuda a diagnosticar
 * rápido, no hay riesgo de exponerlo a un público externo.
 */
export function mensajeErrorSupabase(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string' && (err as any).message) {
    return (err as any).message;
  }
  return fallback;
}
