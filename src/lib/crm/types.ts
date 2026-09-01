// Tipos centrales del dominio CRM Firehouse.
// Cualquier string mágico relacionado al CRM debe tipar contra estos union types,
// nunca declararse suelto en un componente o endpoint.

import type {
  CRM_JOURNEYS,
  CRM_ESTADOS,
  INTERACCION_TIPOS,
  INTERES_OPCIONES,
  EXPERIENCIA_RANGOS,
  CANAL_PREFERIDO,
  RELACION_APODERADO,
  COMO_CONOCIO_OPCIONES,
  INTENCION_INICIAL,
  PRIORIDAD_OPCIONES,
  MOTIVO_DUPLICADO,
} from './constants.ts';

export type Journey = (typeof CRM_JOURNEYS)[keyof typeof CRM_JOURNEYS];
export type CRMStatus = (typeof CRM_ESTADOS)[keyof typeof CRM_ESTADOS];
export type InteractionType = (typeof INTERACCION_TIPOS)[keyof typeof INTERACCION_TIPOS];
export type Interest = (typeof INTERES_OPCIONES)[keyof typeof INTERES_OPCIONES];
export type ExperienceRange = (typeof EXPERIENCIA_RANGOS)[keyof typeof EXPERIENCIA_RANGOS];
export type PreferredChannel = (typeof CANAL_PREFERIDO)[keyof typeof CANAL_PREFERIDO];
export type RelacionApoderado = (typeof RELACION_APODERADO)[keyof typeof RELACION_APODERADO];
export type ComoConocio = (typeof COMO_CONOCIO_OPCIONES)[keyof typeof COMO_CONOCIO_OPCIONES];
export type IntencionInicial = (typeof INTENCION_INICIAL)[keyof typeof INTENCION_INICIAL];
export type Prioridad = (typeof PRIORIDAD_OPCIONES)[keyof typeof PRIORIDAD_OPCIONES];
export type MotivoDuplicado = (typeof MOTIVO_DUPLICADO)[keyof typeof MOTIVO_DUPLICADO];

/** Entrada cruda de un atleta tal como llega desde el paso 2 del formulario público. */
export interface AtletaInput {
  nombre: string;
  apellidos: string;
  fechaNacimiento: string; // ISO yyyy-mm-dd
  firehouseActual: boolean;
  /** Sólo relevante si firehouseActual = true */
  intencionInicial: IntencionInicial | null;
  /** Sólo relevante si firehouseActual = false */
  tieneExperiencia: boolean | null;
  aniosExperiencia: ExperienceRange | null;
  academiaAnterior: string | null;
  /** Sólo relevante si firehouseActual = false */
  interes: Interest | null;
  /** Sólo se llena cuando interes = CLASE_PRUEBA. Día de la semana, no fecha exacta. */
  diaClasePrueba: 'VIERNES' | 'SABADO' | null;
}

/** Resultado de clasificar un atleta: journey + intención derivada. */
export interface ClasificacionJourney {
  journey: Journey;
  intencionInicial: IntencionInicial | null;
}

export interface ApoderadoInput {
  nombre: string;
  apellidos: string;
  telefono: string;
  telefonoSecundario: string | null;
  email: string;
  relacion: RelacionApoderado;
  comuna: string;
  comoConocio: ComoConocio;
  canalPreferido: PreferredChannel;
  comentarioInicial: string | null;
  consentContact: boolean;
  privacyPolicyVersion: string;
}

export interface RegistroPublicoInput {
  submissionId: string; // UUID generado en el cliente, usado como idempotency key
  apoderado: ApoderadoInput;
  atletas: AtletaInput[];
  honeypot: string; // debe llegar vacío
  formStartedAtMs: number; // epoch ms en que se mostró el formulario, anti-bot
  turnstileToken?: string | null;
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };
