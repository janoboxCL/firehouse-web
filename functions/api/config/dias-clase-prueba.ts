// Cloudflare Pages Function — GET /api/config/dias-clase-prueba
//
// Endpoint público de sólo lectura: qué días (viernes/sábado) están habilitados
// para pedir clase de prueba en /registro. El formulario lo consulta al cargar.
// No expone nada sensible — sólo 2 booleanos — así que no requiere autenticación,
// pero igual pasa por el service role acá (nunca se le da a anon acceso directo
// a la tabla, mismo criterio que el resto del CRM).

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

// Si algo falla, el valor más seguro es "nada disponible" — nunca ofrecer un
// día que en realidad no está habilitado.
const RESPALDO = { viernes: false, sabado: false };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(200, RESPALDO);
  }

  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.from('configuracion_clase_prueba').select('dia, habilitado');
    if (error || !data) return jsonResponse(200, RESPALDO);

    const viernes = data.find((d) => d.dia === 'VIERNES')?.habilitado === true;
    const sabado = data.find((d) => d.dia === 'SABADO')?.habilitado === true;
    return jsonResponse(200, { viernes, sabado });
  } catch (err) {
    console.error('dias_clase_prueba_error', (err as Error).message?.slice(0, 200));
    return jsonResponse(200, RESPALDO);
  }
};
