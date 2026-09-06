/// <reference types="@cloudflare/workers-types" />
// GET /api/rifa/estado-orden?orden=RIFA-... — usado por /rifa/gracias para saber
// si el pago ya fue confirmado. Nunca devuelve datos del comprador, sólo el
// estado y el resumen de la compra.

import { createClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const orden = url.searchParams.get('orden');
  if (!orden) return jsonResponse(400, { error: 'falta_orden' });

  const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('rifa_ventas')
    .select('estado, cantidad_numeros, monto')
    .eq('commerce_order', orden)
    .maybeSingle();

  if (error || !data) return jsonResponse(404, { error: 'orden_no_encontrada' });

  return jsonResponse(200, data);
};
