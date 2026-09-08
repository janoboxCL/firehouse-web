/// <reference types="@cloudflare/workers-types" />
// GET /api/campana-2026/contador — estado público del contador de la campaña.
// Sólo cuenta órdenes PAGADA (vista campana_contador). Nunca expone datos
// del comprador: sólo los tres números que se muestran en la web.

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
    const { data, error } = await supabase.from('campana_contador').select('blaze, nova, pack').single();

    if (error || !data) return jsonResponse(500, { error: 'no_se_pudo_leer_contador', detalle: error?.message });

    return jsonResponse(200, data);
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
