// Variables de las plantillas de mensajes y su reemplazo. Lógica pura.
//
// Una variable sin valor disponible NO se reemplaza por texto vacío: se informa
// como faltante para que el panel no deje enviar un mensaje incompleto.

export const VARIABLES_PLANTILLA = {
  nombre_apoderado: 'Nombre de pila del apoderado',
  nombre_atleta: 'Nombre de la niña o niño',
  remitente: 'Tu nombre para mensajes (Configuración)',
  cargo: 'Tu cargo: Head Coach, coach o asistente',
  fecha_clase: 'Fecha de la clase de prueba, ej.: "el sábado 3 de octubre"',
  hora_clase: 'Hora de la clase de prueba',
  talla: 'Talla de polera registrada',
  valor_inscripcion: 'Valor de la inscripción Star vigente',
  link_pago: 'Link de pago de la familia',
} as const;

export type VariablePlantilla = keyof typeof VARIABLES_PLANTILLA;
export type DatosPlantillaMensaje = Partial<Record<VariablePlantilla, string | null | undefined>>;

export interface ResultadoPlantilla {
  texto: string;
  faltantes: VariablePlantilla[];
}

/** Variables que usa un texto (solo las conocidas, sin repetir). */
export function variablesUsadas(texto: string): VariablePlantilla[] {
  const encontradas = new Set<VariablePlantilla>();
  for (const m of texto.matchAll(/\{([a-z_]+)\}/g)) {
    if (m[1] in VARIABLES_PLANTILLA) encontradas.add(m[1] as VariablePlantilla);
  }
  return [...encontradas];
}

export function completarPlantilla(texto: string, datos: DatosPlantillaMensaje): ResultadoPlantilla {
  const faltantes: VariablePlantilla[] = [];
  let resultado = texto;
  for (const variable of variablesUsadas(texto)) {
    const valor = datos[variable];
    if (valor === null || valor === undefined || String(valor).trim() === '') {
      faltantes.push(variable);
      continue;
    }
    resultado = resultado.replaceAll(`{${variable}}`, String(valor).trim());
  }
  return { texto: resultado, faltantes };
}

/** Explica al usuario qué falta para poder enviar. */
export function mensajeFaltantes(faltantes: VariablePlantilla[]): string {
  if (faltantes.length === 0) return '';
  const partes = faltantes.map((v) => {
    if (v === 'talla') return 'registrar la talla de polera';
    if (v === 'link_pago') return 'el link de pago (disponible cuando esté la página de pago)';
    if (v === 'remitente') return 'tu nombre para mensajes (en Configuración)';
    if (v === 'fecha_clase') return 'la fecha de la clase de prueba';
    return VARIABLES_PLANTILLA[v].toLowerCase();
  });
  return `Para enviar esta plantilla falta: ${partes.join(', ')}.`;
}

/**
 * Cargo tal como va dentro de una frase: "Head Coach" se mantiene (es un
 * título), "Coach" y "Asistente" van en minúscula ("Alejandro, asistente de…").
 */
export function cargoEnMensaje(cargo: string | null | undefined): string | null {
  const limpio = (cargo ?? '').trim();
  if (!limpio) return null;
  return limpio === 'Head Coach' ? limpio : limpio.toLowerCase();
}

export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "el sábado 3 de octubre" a partir de una fecha YYYY-MM-DD. */
export function fechaClaseTexto(fechaISO: string | null | undefined): string | null {
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return null;
  const fecha = new Date(`${fechaISO}T12:00:00Z`);
  const texto = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(fecha);
  return `el ${texto.replace(',', '')}`;
}

/** Enlace de WhatsApp con el texto listo. Acepta +56 9 1234 5678 en cualquier formato. */
export function enlaceWhatsApp(telefono: string, texto: string): string {
  return `https://wa.me/${telefono.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

// Las tallas de polera se editan en Configuración (config-academia.ts guarda el respaldo).
