// Contrato común para cualquier pasarela de pago de la Campaña 2026.
//
// Nada en crear-orden.ts ni en los webhooks debería saber si está hablando
// con Flow, Mercado Pago o (a futuro) Getnet — sólo hablan con esta interfaz.
// Agregar una pasarela nueva es: un archivo nuevo acá que la implemente, una
// fila nueva en campana_pasarelas, y nada más.

export type PasarelaId = 'FLOW' | 'MERCADOPAGO' | 'GETNET';

export interface ItemPreferencia {
  producto: string; // 'BLAZE' | 'NOVA' | 'BLAZE_NOVA'
  nombre: string; // título visible en el checkout de la pasarela
  precio: number;
}

export interface CrearPreferenciaInput {
  commerceOrder: string;
  items: ItemPreferencia[];
  email: string;
  urlWebhook: string;
  urlExito: string;
  urlPendiente: string;
  urlError: string;
}

export interface CrearPreferenciaResultado {
  /** URL a la que hay que redirigir al comprador para pagar. */
  urlPago: string;
  /** Identificador que la pasarela entrega al crear el intento (preference_id / token). */
  referenciaExterna: string;
}

/** Vocabulario interno común, independiente de cómo cada pasarela nombre sus estados. */
export type EstadoPagoNormalizado = 'APROBADO' | 'PENDIENTE' | 'RECHAZADO' | 'REEMBOLSADO';

export interface EstadoPagoConsultado {
  estado: EstadoPagoNormalizado;
  commerceOrder: string;
  pasarelaPaymentId: string;
  monto: number;
  moneda: string;
  metodoPago: string | null;
  /** Respuesta cruda de la pasarela, para guardar en campana_pagos.datos_json (auditoría). */
  datosCrudos: Record<string, unknown>;
}

export interface VerificacionNotificacion {
  valida: boolean;
  /** Identificador del pago a consultar (payment_id / token), si se pudo extraer. */
  referenciaPago?: string;
  motivoRechazo?: string;
}

export interface PaymentProvider {
  readonly id: PasarelaId;
  crearPreferencia(input: CrearPreferenciaInput): Promise<CrearPreferenciaResultado>;
  /** Valida la autenticidad de una notificación entrante (firma/HMAC según la pasarela). */
  verificarNotificacion(request: Request): Promise<VerificacionNotificacion>;
  /** Vuelve a consultar el pago DIRECTO a la API de la pasarela — nunca se confía en la notificación por sí sola. */
  obtenerEstadoPago(referenciaPago: string): Promise<EstadoPagoConsultado>;
}
