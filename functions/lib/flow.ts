// Cliente de Flow (https://flow.cl) — crear órdenes de pago y consultar su estado.
//
// Usa Web Crypto (crypto.subtle) porque esto corre en el runtime de Cloudflare
// Workers, no en Node: no hay módulo "crypto" de Node disponible acá.
//
// Documentación de referencia: https://developers.flow.cl/en/api

export interface FlowCredenciales {
  apiKey: string;
  secretKey: string;
  /** https://sandbox.flow.cl/api en pruebas, https://www.flow.cl/api en producción */
  baseUrl: string;
}

export interface FlowCrearPagoParams {
  commerceOrder: string;
  subject: string;
  amount: number;
  email: string;
  urlConfirmation: string;
  urlReturn: string;
  /** Datos propios que Flow devuelve tal cual junto al estado del pago (ej. código de rifa). */
  optional?: Record<string, string>;
  currency?: string;
  /** Segundos hasta que expira la orden si nadie paga. */
  timeout?: number;
}

export interface FlowCrearPagoRespuesta {
  url: string;
  token: string;
  flowOrder: number;
}

export interface FlowEstadoPago {
  flowOrder: number;
  commerceOrder: string;
  status: number; // 1 = pendiente, 2 = pagada. 3/4 (rechazada/anulada): confirmar contra el dashboard de Flow antes de asumir el significado exacto.
  amount: number;
  currency: string;
  payer: string;
  optional?: Record<string, string>;
  paymentData?: { media: string; date: string } & Record<string, unknown>;
}

function aTextoPlano(obj: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = String(v);
  return out;
}

/**
 * Firma según el algoritmo de Flow: ordenar los parámetros alfabéticamente por
 * nombre, concatenar "nombreValor" de cada uno, y firmar ese string con
 * HMAC-SHA256 usando el secretKey. El resultado va en el parámetro "s".
 */
async function firmarFlow(params: Record<string, string | number>, secretKey: string): Promise<string> {
  const claves = Object.keys(params).sort();
  const texto = claves.map((k) => `${k}${params[k]}`).join('');

  const encoder = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, encoder.encode(texto));
  return Array.from(new Uint8Array(firma))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Crea una orden de pago en Flow. Devuelve la URL + token para redirigir al
 * pagador: se navega a `${url}?token=${token}`.
 */
export async function crearPagoFlow(
  creds: FlowCredenciales,
  params: FlowCrearPagoParams,
): Promise<FlowCrearPagoRespuesta> {
  const base: Record<string, string | number> = {
    apiKey: creds.apiKey,
    commerceOrder: params.commerceOrder,
    subject: params.subject,
    currency: params.currency ?? 'CLP',
    amount: params.amount,
    email: params.email,
    urlConfirmation: params.urlConfirmation,
    urlReturn: params.urlReturn,
  };
  if (params.optional) base.optional = JSON.stringify(params.optional);
  if (params.timeout) base.timeout = params.timeout;

  const s = await firmarFlow(base, creds.secretKey);
  const body = new URLSearchParams({ ...aTextoPlano(base), s });

  const res = await fetch(`${creds.baseUrl}/payment/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`flow_create_http_${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Consulta el estado real de un pago en Flow a partir del token que Flow
 * envía a urlConfirmation. NUNCA hay que confiar solo en el POST de Flow: hay
 * que volver a preguntarle a Flow con este método antes de marcar algo pagado.
 */
export async function obtenerEstadoPagoFlow(creds: FlowCredenciales, token: string): Promise<FlowEstadoPago> {
  const params: Record<string, string> = { apiKey: creds.apiKey, token };
  const s = await firmarFlow(params, creds.secretKey);
  const query = new URLSearchParams({ ...params, s });

  const res = await fetch(`${creds.baseUrl}/payment/getStatus?${query.toString()}`);
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`flow_status_http_${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  return res.json();
}
