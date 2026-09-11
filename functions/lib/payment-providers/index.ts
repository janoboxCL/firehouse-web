// Punto único donde se decide "qué pasarela se usa" y "cómo se instancia".
// crear-orden.ts y los webhooks nunca importan Flow ni Mercado Pago directo
// — sólo esto.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PasarelaId, PaymentProvider } from './types.ts';
import { FlowProvider } from './flow.ts';
import { MercadoPagoProvider } from './mercadopago.ts';

export interface PaymentProvidersEnv {
  FLOW_API_KEY?: string;
  FLOW_SECRET_KEY?: string;
  FLOW_BASE_URL?: string;
  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_WEBHOOK_SECRET?: string;
  MERCADOPAGO_ENV?: string; // 'test' | 'production'
}

/**
 * Pasarela a usar para una compra nueva: la marcada `preferida` entre las
 * `habilitada`, o si no hay ninguna preferida, la primera habilitada por
 * orden alfabético (determinístico, no es una decisión de negocio real —
 * en la práctica siempre se configura una preferida).
 */
export async function elegirPasarelaHabilitada(supabase: SupabaseClient): Promise<PasarelaId | null> {
  const { data, error } = await supabase
    .from('campana_pasarelas')
    .select('id')
    .eq('habilitada', true)
    .order('preferida', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as PasarelaId;
}

export function construirPaymentProvider(id: PasarelaId, env: PaymentProvidersEnv): PaymentProvider {
  if (id === 'FLOW') {
    if (!env.FLOW_API_KEY || !env.FLOW_SECRET_KEY || !env.FLOW_BASE_URL) {
      throw new Error('faltan_variables_de_entorno_flow');
    }
    return new FlowProvider({ apiKey: env.FLOW_API_KEY, secretKey: env.FLOW_SECRET_KEY, baseUrl: env.FLOW_BASE_URL });
  }
  if (id === 'MERCADOPAGO') {
    if (!env.MERCADOPAGO_ACCESS_TOKEN || !env.MERCADOPAGO_WEBHOOK_SECRET) {
      throw new Error('faltan_variables_de_entorno_mercadopago');
    }
    // "Test" vs "producción" lo decide qué access token cargaste en Cloudflare
    // (el de una cuenta de prueba, o el real) — el código no distingue entre
    // ambos casos, así que MERCADOPAGO_ENV ya no cambia ningún comportamiento
    // acá. Se mantiene sólo como referencia humana de qué credenciales están cargadas.
    return new MercadoPagoProvider({
      accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
      webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
    });
  }
  throw new Error(`pasarela_no_implementada: ${id}`);
}
