/// <reference types="@cloudflare/workers-types" />
// GET /api/rifa/numeros — estado público de los números de la rifa.
// Nunca expone datos de rifa_ventas (comprador): sólo número + estado.

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
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    // Libera reservas vencidas antes de responder, para que el estado se vea al día.
    await supabase.rpc('fn_liberar_reservas_vencidas_rifa');

    const { data, error } = await supabase.from('rifa_numeros').select('numero, estado').order('numero');

    if (error || !data) return jsonResponse(500, { error: 'no_se_pudo_leer_numeros', detalle: error?.message });

    return jsonResponse(200, { numeros: data });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
