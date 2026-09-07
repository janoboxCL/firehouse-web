// Cliente de Khipu (https://khipu.com) — crear cobros y consultar su estado.
//
// A diferencia de Flow, la API v3 de Khipu no requiere firma: basta con un
// header "x-api-key" con la llave que se genera desde el panel de Khipu
// (Opciones de cuenta → "Integrar Khipu a tu sitio web" → API Keys).
//
// Importante: Khipu no tiene un dominio de sandbox separado como Flow. El
// modo prueba/producción lo define la llave que uses (genera una "en modo
// desarrollo" para probar) — la URL base es siempre la misma.
//
// Documentación de referencia: https://docs.khipu.com

export interface KhipuCredenciales {
  apiKey: string;
  /** Normalmente https://payment-api.khipu.com/v3 — no cambia entre pruebas y producción. */
  baseUrl: string;
}

export interface KhipuCrearPagoParams {
  transactionId: string;
  subject: string;
  amount: number;
  currency?: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  payerEmail?: string;
}

export interface KhipuCrearPagoRespuesta {
  paymentId: string;
  paymentUrl: string;
  simplifiedTransferUrl: string;
  transferUrl: string;
}

export interface KhipuEstadoPago {
  paymentId: string;
  transactionId: string;
  status: string; // 'done' = pagado, confirmado contra la documentación/ejemplos de Khipu. Otros valores (pending, expired, rejected) se tratan como no pagado.
  amount: number;
  currency: string;
}

async function khipuFetch<T>(creds: KhipuCredenciales, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      'x-api-key': creds.apiKey,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`khipu_http_${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  return res.json();
}

export async function crearPagoKhipu(creds: KhipuCredenciales, params: KhipuCrearPagoParams): Promise<KhipuCrearPagoRespuesta> {
  const data = await khipuFetch<{
    payment_id: string;
    payment_url: string;
    simplified_transfer_url: string;
    transfer_url: string;
  }>(creds, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      transaction_id: params.transactionId,
      subject: params.subject,
      amount: params.amount,
      currency: params.currency ?? 'CLP',
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      notify_url: params.notifyUrl,
      notify_api_version: '3.0',
      ...(params.payerEmail ? { payer_email: params.payerEmail } : {}),
    }),
  });

  return {
    paymentId: data.payment_id,
    paymentUrl: data.payment_url,
    simplifiedTransferUrl: data.simplified_transfer_url,
    transferUrl: data.transfer_url,
  };
}

export async function obtenerEstadoPagoKhipu(creds: KhipuCredenciales, paymentId: string): Promise<KhipuEstadoPago> {
  const data = await khipuFetch<{
    payment_id: string;
    transaction_id: string;
    status: string;
    amount: number;
    currency: string;
  }>(creds, `/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });

  return {
    paymentId: data.payment_id,
    transactionId: data.transaction_id,
    status: data.status,
    amount: data.amount,
    currency: data.currency,
  };
}
