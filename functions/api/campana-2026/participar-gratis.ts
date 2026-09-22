/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/participar-gratis
// Registra una (1) participación gratuita por RUT, conforme a las Bases,
// Séptimo. Nunca confía en la validación del navegador — el RUT y el resto
// de los campos se revalidan acá antes de tocar la base de datos.

import { createClient } from '@supabase/supabase-js';
import { rutValido } from '../../lib/rut.ts';
import { enviarCorreoParticipacionGratisCampana } from '../../lib/resend.ts';
import { CAMPAIGN_BASES_VERSION, CAMPAIGN_ID, enmascararRut, identityHash } from '../../lib/campaign-2026.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
  CAMPAIGN_IDENTITY_SECRET: string;
  TURNSTILE_SECRET_KEY?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse(400, { error: 'json_invalido' });
    }

    const nombre = String(body.nombre ?? '').trim().slice(0, 150);
    const email = String(body.email ?? '').trim().slice(0, 254);
    const telefono = String(body.telefono ?? '').trim().slice(0, 20);
    const rutCrudo = String(body.rut ?? '').trim();
    const aceptaBases = body.aceptaBases === true;
    const basesVersion = String(body.basesVersion ?? '');
    const honeypot = String(body.website ?? '');

    if (nombre.length < 3) return jsonResponse(400, { error: 'nombre_invalido' });
    if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: 'email_invalido' });
    if (telefono.replace(/\D/g, '').length < 8) return jsonResponse(400, { error: 'telefono_invalido' });
    if (!rutValido(rutCrudo)) return jsonResponse(400, { error: 'rut_invalido' });
    if (!aceptaBases) return jsonResponse(400, { error: 'debe_aceptar_las_bases' });
    if (basesVersion !== CAMPAIGN_BASES_VERSION) return jsonResponse(400, { error: 'bases_desactualizadas' });
    if (honeypot) return jsonResponse(200, { asignadas: 0, total: 0, codigos: [] });
    if (!context.env.CAMPAIGN_IDENTITY_SECRET) return jsonResponse(503, { error: 'campana_no_configurada' });

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: config } = await supabase.from('campana_config').select('participacion_habilitada,bases_version,inicio_at,cierre_at').eq('id', 1).single();
    const ahora = Date.now();
    if (!config?.participacion_habilitada || config.bases_version !== basesVersion || !config.inicio_at || !config.cierre_at
      || ahora < Date.parse(config.inicio_at) || ahora > Date.parse(config.cierre_at)) return jsonResponse(403, { error: 'participacion_deshabilitada' });

    const forwarded = context.request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const rateKey = await identityHash(`${forwarded}:${rutCrudo}`, context.env.CAMPAIGN_IDENTITY_SECRET);
    const cache = caches.default;
    const rateRequest = new Request(`https://rate-limit.invalid/${rateKey}`);
    if (await cache.match(rateRequest)) return jsonResponse(429, { error: 'demasiadas_solicitudes' });
    await cache.put(rateRequest, new Response('1', { headers: { 'cache-control': 'max-age=30' } }));

    const now = new Date().toISOString();
    const hash = await identityHash(rutCrudo, context.env.CAMPAIGN_IDENTITY_SECRET);
    const { data: participante, error: participantError } = await supabase.from('campana_participantes').upsert({
      campaign_id: CAMPAIGN_ID, identity_hash: hash, rut_masked: enmascararRut(rutCrudo), nombre, email, telefono,
      bases_version: basesVersion, bases_accepted_at: now, updated_at: now,
    }, { onConflict: 'campaign_id,identity_hash' }).select('id').single();
    if (participantError || !participante) return jsonResponse(500, { error: 'no_se_pudo_identificar_participante' });

    const { data, error } = await supabase.rpc('fn_registrar_entrada_gratis_campana', {
      p_participant_id: participante.id,
      p_bases_version: basesVersion,
    });

    if (error) {
      return jsonResponse(500, { error: 'no_se_pudo_registrar', detalle: error.message });
    }

    const resultado = data as { asignadas?: number; total?: number; codigos?: string[] };
    const codigos = resultado.codigos ?? [];

    if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_CAMPANA || context.env.EMAIL_FROM)) {
      try {
        const { data: claimed } = await supabase.from('campana_email_outbox').update({ status: 'SENDING' })
          .eq('tipo', 'PARTICIPACION_GRATIS').eq('participant_id', participante.id).eq('status', 'PENDING').select('id').maybeSingle();
        if (!claimed) return jsonResponse(200, { asignadas: resultado.asignadas ?? 0, total: resultado.total ?? 0, codigos });
        await enviarCorreoParticipacionGratisCampana(
          context.env.RESEND_API_KEY,
          context.env.EMAIL_FROM_CAMPANA ?? context.env.EMAIL_FROM!,
          { nombre, email, codigos, total: resultado.total ?? 0 },
          [],
        );
        await supabase.from('campana_email_outbox').update({ status: 'SENT', sent_at: new Date().toISOString(), attempts: 1 }).eq('id', claimed.id);
      } catch (err) {
        console.error('email_participacion_gratis_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        await supabase.from('campana_email_outbox').update({ status: 'FAILED', last_error: err instanceof Error ? err.message.slice(0, 500) : 'desconocido' }).eq('participant_id', participante.id).eq('tipo', 'PARTICIPACION_GRATIS');
      }
    }

    return jsonResponse(200, { asignadas: resultado.asignadas ?? 0, total: resultado.total ?? 0, codigos });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
