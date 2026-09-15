/// <reference types="@cloudflare/workers-types" />
// GET /api/registro-star/orden?orden=<uuid>
//
// Endpoint de solo lectura para la página de gracias. Igual que
// /api/campana-2026/orden: nunca confía en la URL de retorno de la
// pasarela, siempre vuelve a preguntar acá el estado real de la orden.
// El UUID funciona como el "secreto" de acceso — sólo lo recibe el
// apoderado, en la URL a la que la pasarela redirige tras el pago.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
    }

    const ordenId = new URL(context.request.url).searchParams.get('orden')?.trim() ?? '';
    if (!UUID_RE.test(ordenId)) {
      return jsonResponse(400, { error: 'orden_invalida' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: orden, error } = await supabase
      .from('star_ordenes')
      .select('id, estado, apoderado_nombre, monto, star_orden_atletas ( atleta_nombre )')
      .eq('id', ordenId)
      .maybeSingle();

    if (error) return jsonResponse(500, { error: 'no_se_pudo_consultar', detalle: error.message });
    if (!orden) return jsonResponse(404, { error: 'orden_no_encontrada' });

    if (orden.estado !== 'PAGADA') {
      // 202: la orden existe pero el pago todavía no se confirma (puede
      // estar en camino si el webhook no ha llegado todavía) o no se
      // completó.
      return jsonResponse(202, { estado: orden.estado });
    }

    const atletaNombres = ((orden as unknown as { star_orden_atletas: { atleta_nombre: string }[] }).star_orden_atletas ?? []).map(
      (a) => a.atleta_nombre,
    );

    return jsonResponse(200, {
      estado: 'PAGADA',
      apoderadoNombre: orden.apoderado_nombre,
      atletaNombres,
      monto: orden.monto,
    });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
