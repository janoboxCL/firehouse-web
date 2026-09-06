/// <reference types="@cloudflare/workers-types" />
// POST /api/rifa/flow-webhook — urlConfirmation que recibe Flow.
//
// Flow envía sólo un "token" por POST. NUNCA hay que confiar en eso solo: hay
// que volver a preguntarle a Flow el estado real con ese token antes de marcar
// algo como pagado (por si alguien intenta llamar a esta URL directamente).

import { createClient } from '@supabase/supabase-js';
import { obtenerEstadoPagoFlow } from '../../lib/flow.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FLOW_API_KEY: string;
  FLOW_SECRET_KEY: string;
  FLOW_BASE_URL: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const token = form?.get('token');

  if (!token || typeof token !== 'string') {
    return new Response('falta token', { status: 400 });
  }

  const creds = {
    apiKey: context.env.FLOW_API_KEY,
    secretKey: context.env.FLOW_SECRET_KEY,
    baseUrl: context.env.FLOW_BASE_URL,
  };

  let estado;
  try {
    estado = await obtenerEstadoPagoFlow(creds, token);
  } catch {
    // Si Flow no responde ahora mismo, no confirmamos nada. Flow reintenta la
    // notificación más tarde si no recibe una respuesta 200 de esta URL.
    return new Response('no se pudo confirmar con flow', { status: 502 });
  }

  const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

  if (estado.status === 2) {
    await supabase.rpc('fn_confirmar_pago_rifa', {
      p_commerce_order: estado.commerceOrder,
      p_flow_order: estado.flowOrder,
      p_flow_payment_data: estado.paymentData ?? {},
    });
  } else {
    // status 1 = pendiente (no debería llegar acá todavía), 3/4 = rechazada/anulada.
    await supabase.rpc('fn_marcar_venta_no_pagada_rifa', {
      p_commerce_order: estado.commerceOrder,
      p_estado: 'RECHAZADA',
    });
  }

  return new Response('ok', { status: 200 });
};
