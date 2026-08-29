// Cloudflare Pages Function — POST /api/admin/enviar-correo
//
// Único punto por el que el panel admin puede disparar un correo real (Resend).
// La service role key y RESEND_API_KEY nunca llegan al navegador; acá se verifica
// que quien llama sea un admin activo antes de enviar nada.

import { createClient } from '@supabase/supabase-js';
import { enviarCorreoGenerico } from '../../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

const MAX_HTML = 20_000;
const MAX_ASUNTO = 200;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return jsonResponse(400, { error: 'EMAIL_NOT_CONFIGURED', message: 'El envío de correo todavía no está configurado.' });
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return jsonResponse(401, { error: 'UNAUTHORIZED' });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('enviar_correo_config_error');
    return jsonResponse(500, { error: 'INTERNAL_ERROR' });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Verifica el token del navegador contra Supabase Auth — nunca confiamos en un
  // user_id que venga directo en el body de la solicitud.
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(401, { error: 'UNAUTHORIZED' });
  }

  const { data: perfil } = await supabase
    .from('admin_profiles')
    .select('active')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!perfil?.active) {
    return jsonResponse(403, { error: 'FORBIDDEN', message: 'Tu cuenta no está activa.' });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'VALIDATION_ERROR' });
  }

  const { to, subject, html } = body ?? {};
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof html !== 'string' || !to || !subject || !html) {
    return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'Faltan campos (to, subject, html).' });
  }
  if (subject.length > MAX_ASUNTO || html.length > MAX_HTML) {
    return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'El contenido es demasiado largo.' });
  }

  try {
    await enviarCorreoGenerico(env.RESEND_API_KEY, env.EMAIL_FROM, to, subject, html);
  } catch (err) {
    console.error('admin_enviar_correo_error', (err as Error).message?.slice(0, 200));
    return jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'No pudimos enviar el correo.' });
  }

  return jsonResponse(200, { success: true });
};
