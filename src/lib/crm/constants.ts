// Constantes centrales del CRM Firehouse.
// Estos valores son el contrato entre formulario público, endpoint, base de datos y admin.
// No dispersar estos strings sueltos en otros archivos: importar siempre desde acá.

export const CRM_JOURNEYS = {
  RENOVACION_2027: 'RENOVACION_2027',
  PRETEMPORADA: 'PRETEMPORADA',
  EXPERIMENTADA_2027: 'EXPERIMENTADA_2027',
  PRINCIPIANTE_2027: 'PRINCIPIANTE_2027',
  CLASE_PRUEBA: 'CLASE_PRUEBA',
  POR_CLASIFICAR: 'POR_CLASIFICAR',
} as const;

export const CRM_JOURNEYS_LABEL: Record<string, string> = {
  RENOVACION_2027: 'Renovación 2027',
  PRETEMPORADA: 'Pretemporada',
  EXPERIMENTADA_2027: 'Experimentada 2027',
  PRINCIPIANTE_2027: 'Principiante 2027',
  CLASE_PRUEBA: 'Clase de prueba',
  POR_CLASIFICAR: 'Por clasificar',
};

export const CRM_ESTADOS = {
  NUEVO: 'NUEVO',
  CONTACTADO: 'CONTACTADO',
  SEGUIMIENTO: 'SEGUIMIENTO',
  AGENDADO: 'AGENDADO',
  ASISTIO: 'ASISTIO',
  INSCRITO: 'INSCRITO',
  NO_RESPONDE: 'NO_RESPONDE',
  CONTACTAR_MAS_ADELANTE: 'CONTACTAR_MAS_ADELANTE',
  NO_CONTINUA: 'NO_CONTINUA',
  NO_INTERESADO: 'NO_INTERESADO',
} as const;

export const CRM_ESTADOS_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  SEGUIMIENTO: 'Seguimiento',
  AGENDADO: 'Agendado',
  ASISTIO: 'Asistió',
  INSCRITO: 'Inscrito',
  NO_RESPONDE: 'No responde',
  CONTACTAR_MAS_ADELANTE: 'Contactar más adelante',
  NO_CONTINUA: 'No continúa',
  NO_INTERESADO: 'No interesado',
};

/** Estados de cierre: no requieren próxima acción. */
export const ESTADOS_CERRADOS: readonly string[] = [
  CRM_ESTADOS.INSCRITO,
  CRM_ESTADOS.NO_CONTINUA,
  CRM_ESTADOS.NO_INTERESADO,
];

/** Estados abiertos donde se recomienda (sin bloquear) definir próxima acción + fecha. */
export const ESTADOS_ABIERTOS_CON_SEGUIMIENTO: readonly string[] = [
  CRM_ESTADOS.CONTACTADO,
  CRM_ESTADOS.SEGUIMIENTO,
  CRM_ESTADOS.AGENDADO,
  CRM_ESTADOS.NO_RESPONDE,
  CRM_ESTADOS.CONTACTAR_MAS_ADELANTE,
];

export const INTERACCION_TIPOS = {
  WHATSAPP: 'WHATSAPP',
  LLAMADA: 'LLAMADA',
  EMAIL: 'EMAIL',
  NOTA: 'NOTA',
  CAMBIO_ESTADO: 'CAMBIO_ESTADO',
} as const;

export const INTERACCION_TIPOS_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  LLAMADA: 'Llamada',
  EMAIL: 'Email',
  NOTA: 'Nota',
  CAMBIO_ESTADO: 'Cambio de estado',
};

export const INTERES_OPCIONES = {
  PRETEMPORADA: 'PRETEMPORADA',
  TEMPORADA_2027: 'TEMPORADA_2027',
  CLASE_PRUEBA: 'CLASE_PRUEBA',
  NO_SEGURO: 'NO_SEGURO',
} as const;

export const DIA_CLASE_PRUEBA = {
  VIERNES: 'VIERNES',
  SABADO: 'SABADO',
} as const;

export const DIA_CLASE_PRUEBA_LABEL: Record<string, string> = {
  VIERNES: 'Viernes',
  SABADO: 'Sábado',
};

export const EXPERIENCIA_RANGOS = {
  LT_1: 'LT_1',
  Y1_2: 'Y1_2',
  Y3_4: 'Y3_4',
  Y5_PLUS: 'Y5_PLUS',
} as const;

export const EXPERIENCIA_RANGOS_LABEL: Record<string, string> = {
  LT_1: 'Menos de 1 año',
  Y1_2: '1–2 años',
  Y3_4: '3–4 años',
  Y5_PLUS: '5+ años',
};

export const CANAL_PREFERIDO = {
  WHATSAPP: 'WHATSAPP',
  EMAIL: 'EMAIL',
  CUALQUIERA: 'CUALQUIERA',
} as const;

export const CANAL_PREFERIDO_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Correo electrónico',
  CUALQUIERA: 'Cualquiera de los dos',
};

export const RELACION_APODERADO = {
  MAMA: 'MAMA',
  PAPA: 'PAPA',
  TUTOR: 'TUTOR',
  OTRO: 'OTRO',
} as const;

export const RELACION_APODERADO_LABEL: Record<string, string> = {
  MAMA: 'Mamá',
  PAPA: 'Papá',
  TUTOR: 'Tutor/a',
  OTRO: 'Otro',
};

export const COMO_CONOCIO_OPCIONES = {
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  GOOGLE: 'GOOGLE',
  RECOMENDACION_FAMILIA: 'RECOMENDACION_FAMILIA',
  AMIGO_FAMILIAR: 'AMIGO_FAMILIAR',
  COMPETENCIA_DEPORTIVA: 'COMPETENCIA_DEPORTIVA',
  SITIO_WEB: 'SITIO_WEB',
  OTRO: 'OTRO',
} as const;

export const COMO_CONOCIO_LABEL: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE: 'Google',
  RECOMENDACION_FAMILIA: 'Recomendación de otra familia',
  AMIGO_FAMILIAR: 'Amigo/a o familiar',
  COMPETENCIA_DEPORTIVA: 'Competencia o actividad deportiva',
  SITIO_WEB: 'Sitio web',
  OTRO: 'Otro',
};

export const INTENCION_INICIAL = {
  CONTINUAR: 'CONTINUAR',
  INDECISO: 'INDECISO',
} as const;

export const PRIORIDAD_OPCIONES = {
  NORMAL: 'NORMAL',
  ALTA: 'ALTA',
} as const;

export const MOTIVO_DUPLICADO = {
  PHONE_MATCH: 'PHONE_MATCH',
  EMAIL_MATCH: 'EMAIL_MATCH',
  PHONE_AND_EMAIL_MATCH: 'PHONE_AND_EMAIL_MATCH',
} as const;

export const ORIGEN_CASO = {
  WEB_REGISTRO: 'WEB_REGISTRO',
} as const;

export const ADMIN_ROLES = {
  ADMIN: 'ADMIN',
  GESTOR: 'GESTOR',
} as const;

/** Límites de campos, usados tanto en validación cliente como servidor. */
export const LIMITES = {
  NOMBRE_MIN: 2,
  NOMBRE_MAX: 80,
  APELLIDOS_MAX: 120,
  EMAIL_MAX: 254,
  COMUNA_MAX: 100,
  ACADEMIA_ANTERIOR_MAX: 120,
  COMENTARIO_INICIAL_MAX: 500,
  NOTA_INTERACCION_MAX: 2000,
  PROXIMA_ACCION_MAX: 255,
  TELEFONO_MAX: 20,
  MAX_ATLETAS_POR_REGISTRO: 5,
  EDAD_HABITUAL_MIN: 4,
  EDAD_HABITUAL_MAX: 19,
} as const;

export const PRIVACY_POLICY_VERSION = '2026-08-1';
