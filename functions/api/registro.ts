/// <reference types="@cloudflare/workers-types" />
// Cloudflare Pages Function — POST /api/registro
//
// Único punto de escritura para el formulario público. El navegador nunca tiene
// permisos de INSERT sobre la base de datos: valida acá server-side y llama a
// fn_crear_registro con la service role key (nunca expuesta al cliente).

import { createClient } from '@supabase/supabase-js';
import { validarRegistroPublico } from '../../src/lib/crm/registro.ts';
import { enviarCorreoConfirmacion } from '../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Opcionales — si no están configurados, esas protecciones/funciones simplemente se omiten.
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

const MAX_BODY_BYTES = 20_000;
const MIN_TIEMPO_LLENADO_MS = 1200; // un humano no completa 3 pasos más rápido que esto
const RATE_LIMIT_MAX_POR_HORA = 8;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function verificarTurnstile(token: string | null | undefined, secret: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json<{ success: boolean }>();
    return data.success === true;
  } catch {
    // Si Turnstile no responde, no bloqueamos el registro por un problema de terceros;
    // el resto de las protecciones (honeypot, timing, validación) siguen aplicando.
    return true;
  }
}

async function bajoLimiteDeTasa(kv: KVNamespace | undefined, ip: string): Promise<boolean> {
  if (!kv || ip === 'desconocida') return true;
  const key = `registro:${ip}`;
  const actual = Number((await kv.get(key)) ?? '0');
  if (actual >= RATE_LIMIT_MAX_POR_HORA) return false;
  await kv.put(key, String(actual + 1), { expirationTtl: 3600 });
  return true;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'Solicitud demasiado grande.' });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'JSON inválido.' });
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'desconocida';

  // Honeypot: si un bot llenó el campo trampa, respondemos "éxito" sin escribir nada.
  // No damos pistas de por qué falló.
  if (typeof body?.honeypot === 'string' && body.honeypot.trim() !== '') {
    return jsonResponse(200, { success: true, atletas: [] });
  }

  // Anti-bot por tiempo de llenado: un envío instantáneo no es humano.
  const iniciado = Number(body?.formStartedAtMs ?? 0);
  if (!iniciado || Date.now() - iniciado < MIN_TIEMPO_LLENADO_MS) {
    return jsonResponse(200, { success: true, atletas: [] });
  }

  if (!(await bajoLimiteDeTasa(env.RATE_LIMIT_KV, ip))) {
    return jsonResponse(429, { error: 'RATE_LIMIT', message: 'Demasiados intentos. Intenta más tarde.' });
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const humano = await verificarTurnstile(body?.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
    if (!humano) {
      return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'No pudimos verificar que eres una persona. Intenta de nuevo.' });
    }
  }

  const validacion = validarRegistroPublico(body);
  if (!validacion.ok) {
    return jsonResponse(400, { error: 'VALIDATION_ERROR', fields: validacion.errors });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('registro_config_error missing_supabase_env');
    return jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'No pudimos guardar el registro. Inténtalo nuevamente.' });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc('fn_crear_registro', { payload: validacion.value });

  if (error) {
    // Nunca logueamos PII (teléfonos, emails, nombres, comentarios); sólo el código de error.
    console.error('registro_error', error.code ?? 'unknown');
    return jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'No pudimos guardar el registro. Revisa tu conexión e inténtalo nuevamente.' });
  }

  const nombresAtletas: string[] = Array.isArray(data?.atletas)
    ? data.atletas.map((a: { nombre: string }) => a.nombre)
    : [];

  console.log('registration_created', { apoderadoId: data?.apoderadoId, atletas: data?.atletas?.length ?? 0 });

  // Correo de confirmación: es un "best effort". Si Resend no está configurado
  // todavía, o si falla, el registro YA quedó guardado — nunca lo hacemos fallar por esto.
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      await enviarCorreoConfirmacion(env.RESEND_API_KEY, env.EMAIL_FROM, {
        apoderadoNombre: validacion.value.apoderado.nombre,
        apoderadoEmail: validacion.value.apoderado.email,
        nombresAtletas,
      });
    } catch (err) {
      console.error('email_confirmacion_error', (err as Error).message?.slice(0, 200));
    }
  }

  return jsonResponse(200, { success: true, atletas: nombresAtletas });
};

export const onRequestGet: PagesFunction = async () => {
  return jsonResponse(405, { error: 'METHOD_NOT_ALLOWED' });
};
