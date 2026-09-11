// Cliente de Mercado Pago Checkout Pro.
//
// Verificación de firma según la documentación oficial de Mercado Pago
// (Webhooks → Notificaciones → "Validar el origen de la notificación"):
// manifest = `id:${data.id};request-id:${x-request-id};ts:${ts};`, con
// data.id en minúscula si es alfanumérico, HMAC-SHA256 en hexadecimal
// contra ese manifest, comparado contra el valor "v1" del header
// x-signature (formato: "ts=...,v1=..."). No se inventó ningún detalle de
// este formato — está tomado literalmente de la doc oficial.
//
// Usa Web Crypto (crypto.subtle), igual que functions/lib/flow.ts, porque
// esto corre en el runtime de Cloudflare Workers.

import type {
  PaymentProvider,
  CrearPreferenciaInput,
  CrearPreferenciaResultado,
  VerificacionNotificacion,
  EstadoPagoConsultado,
  EstadoPagoNormalizado,
} from './types.ts';

export interface MercadoPagoCredenciales {
  accessToken: string;
  webhookSecret: string;
}

const API_BASE = 'https://api.mercadopago.com';

function normalizarEstadoMP(status: string): EstadoPagoNormalizado {
  if (status === 'approved') return 'APROBADO';
  if (status === 'pending' || status === 'in_process' || status === 'authorized') return 'PENDIENTE';
  if (status === 'refunded' || status === 'charged_back') return 'REEMBOLSADO';
  return 'RECHAZADO'; // rejected, cancelled y cualquier estado no contemplado
}

async function hmacSha256Hex(secreto: string, mensaje: string): Promise<string> {
  const encoder = new TextEncoder();
  const clave = await crypto.subtle.importKey('raw', encoder.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', clave, encoder.encode(mensaje));
  return Array.from(new Uint8Array(firma))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparación en tiempo constante, para no filtrar la firma correcta por timing. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id = 'MERCADOPAGO' as const;

  constructor(private readonly creds: MercadoPagoCredenciales) {}

  async crearPreferencia(input: CrearPreferenciaInput): Promise<CrearPreferenciaResultado> {
    const res = await fetch(`${API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.creds.accessToken}` },
      body: JSON.stringify({
        items: input.items.map((i) => ({
          title: i.nombre,
          description: 'Colección de contenido digital Firehouse',
          quantity: 1,
          currency_id: 'CLP',
          unit_price: i.precio,
        })),
        external_reference: input.commerceOrder,
        notification_url: input.urlWebhook,
        back_urls: { success: input.urlExito, pending: input.urlPendiente, failure: input.urlError },
        auto_return: 'approved',
      }),
    });

    const cuerpo = await res.text();
    if (!res.ok) {
      throw new Error(`mercadopago_create_http_${res.status}: ${cuerpo.slice(0, 300)}`);
    }
    const data = JSON.parse(cuerpo) as { id: string; init_point: string; sandbox_init_point: string };
    // Mercado Pago documenta que combinar sandbox_init_point con credenciales
    // normales es justamente lo que produce el error "Oh, no, algo anduvo
    // mal" — la forma confiable de probar es usar init_point junto con las
    // credenciales de producción de una cuenta de prueba (ver README de esta
    // carpeta o el mensaje de la entrega). "Test" vs "producción" queda
    // determinado por QUÉ access token se usa, no por qué URL se lee acá.
    return { urlPago: data.init_point, referenciaExterna: data.id };
  }

  async verificarNotificacion(request: Request): Promise<VerificacionNotificacion> {
    const url = new URL(request.url);
    const dataIdCrudo = url.searchParams.get('data.id') ?? url.searchParams.get('id');
    const xSignature = request.headers.get('x-signature');
    const xRequestId = request.headers.get('x-request-id');

    if (!dataIdCrudo || !xSignature || !xRequestId) {
      return { valida: false, motivoRechazo: 'faltan_datos_de_verificacion' };
    }

    // "si data.id es alfanumérico, debe usarse en minúscula" — documentación oficial de Mercado Pago.
    const dataId = /^[a-zA-Z0-9]+$/.test(dataIdCrudo) ? dataIdCrudo.toLowerCase() : dataIdCrudo;

    let ts = '';
    let v1 = '';
    for (const parte of xSignature.split(',')) {
      const [clave, valor] = parte.split('=').map((s) => s.trim());
      if (clave === 'ts') ts = valor;
      if (clave === 'v1') v1 = valor;
    }
    if (!ts || !v1) {
      return { valida: false, motivoRechazo: 'x_signature_mal_formado' };
    }

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const calculado = await hmacSha256Hex(this.creds.webhookSecret, manifest);

    if (!iguales(calculado, v1)) {
      return { valida: false, motivoRechazo: 'firma_invalida' };
    }
    return { valida: true, referenciaPago: dataIdCrudo };
  }

  async obtenerEstadoPago(referenciaPago: string): Promise<EstadoPagoConsultado> {
    const res = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(referenciaPago)}`, {
      headers: { authorization: `Bearer ${this.creds.accessToken}` },
    });
    const cuerpo = await res.text();
    if (!res.ok) {
      throw new Error(`mercadopago_payment_http_${res.status}: ${cuerpo.slice(0, 300)}`);
    }
    const data = JSON.parse(cuerpo) as {
      id: number;
      status: string;
      external_reference: string;
      transaction_amount: number;
      currency_id: string;
      payment_method_id: string | null;
    };

    return {
      estado: normalizarEstadoMP(data.status),
      commerceOrder: data.external_reference,
      pasarelaPaymentId: String(data.id),
      monto: Math.round(data.transaction_amount),
      moneda: data.currency_id,
      metodoPago: data.payment_method_id,
      datosCrudos: data as unknown as Record<string, unknown>,
    };
  }
}
