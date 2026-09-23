// Verificación de administrador para Pages Functions del panel.
// Mismo criterio que functions/api/admin/enviar-correo.ts: el token del navegador
// se valida contra Supabase Auth y luego se exige un perfil admin activo.
// Nunca se confía en un user_id que venga en el body.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AdminEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export type ResultadoAdmin =
  | { ok: true; supabase: SupabaseClient; userId: string }
  | { ok: false; status: number; error: string };

export async function verificarAdmin(request: Request, env: AdminEnv): Promise<ResultadoAdmin> {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 500, error: 'CONFIG_ERROR' };

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, status: 401, error: 'UNAUTHORIZED' };

  const { data: perfil } = await supabase
    .from('admin_profiles')
    .select('active')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!perfil?.active) return { ok: false, status: 403, error: 'FORBIDDEN' };

  return { ok: true, supabase, userId: userData.user.id };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
