/// <reference types="@cloudflare/workers-types" />
// GET /api/campana-2026/deportista?codigo=FH-XXXXXX
// Resuelve un código de referido al primer nombre del deportista, para
// mostrar "Estás apoyando a Benjamín" en la página de la campaña.
//
// Reutiliza la misma tabla rifa_codigos que ya usa /sorteo (creada antes,
// fuera de las migraciones versionadas). Solo expone el nombre — nunca
// apellidos, atleta_id ni meta_minima — porque el código ya es público
// (se comparte en el enlace) pero el resto de la fila no tiene por qué serlo.

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

    const codigo = new URL(context.request.url).searchParams.get('codigo')?.trim().slice(0, 12);
    if (!codigo) {
      return jsonResponse(400, { error: 'falta_codigo' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('rifa_codigos')
      .select('atletas ( nombre )')
      .eq('codigo', codigo)
      .maybeSingle<{ atletas: { nombre: string } | null }>();

    if (error) {
      return jsonResponse(500, { error: 'no_se_pudo_consultar', detalle: error.message });
    }
    if (!data?.atletas?.nombre) {
      return jsonResponse(404, { error: 'codigo_no_encontrado' });
    }

    return jsonResponse(200, { nombre: data.atletas.nombre });
  } catch (e) {
    return jsonResponse(500, {
      error: 'error_inesperado',
      detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
  }
};
