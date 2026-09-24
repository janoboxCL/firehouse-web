// POST /api/pagar/recuperar  { email }
// Reenvía el link de la cuenta al correo registrado. Siempre responde lo mismo,
// exista o no el correo, para no revelar quién está registrado.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { primerNombre } from '../../lib/cuenta-servidor.ts';
import { enviarLinkCuenta } from '../../lib/resend.ts';
import { urlCuenta } from '../../../src/lib/crm/cuenta.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_STAR?: string;
  SITE_URL?: string;
}

const RESPUESTA = { ok: true, mensaje: 'Si el correo está registrado, te enviamos el link en unos minutos.' };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = '';
  try {
    const cuerpo = (await request.json()) as Record<string, unknown>;
    if (cuerpo.sitio) return jsonResponse(200, RESPUESTA); // honeypot
    email = String(cuerpo.email ?? '').trim().toLowerCase();
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return jsonResponse(200, RESPUESTA);
  const remitente = env.EMAIL_FROM_STAR ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !remitente) return jsonResponse(200, RESPUESTA);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: apoderados } = await supabase.from('apoderados').select('id, nombre, email').ilike('email', email).limit(5);
  const ids = (apoderados ?? []).map((a) => a.id as string);
  if (ids.length === 0) return jsonResponse(200, RESPUESTA);

  const { data: links } = await supabase.from('links_pago').select('apoderado_id, token').in('apoderado_id', ids).is('revocado_at', null);
  for (const l of links ?? []) {
    const ap = apoderados!.find((a) => a.id === l.apoderado_id)!;
    try {
      await enviarLinkCuenta(env.RESEND_API_KEY, remitente, {
        nombre: primerNombre(ap.nombre as string),
        email: ap.email as string,
        url: urlCuenta(env.SITE_URL ?? 'https://firehousecheer.cl', l.token as string),
      });
    } catch {
      /* se responde igual */
    }
  }
  return jsonResponse(200, RESPUESTA);
};
