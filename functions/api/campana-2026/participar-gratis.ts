/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/participar-gratis
// Registra una (1) participación gratuita por RUT, conforme a las Bases,
// Séptimo. Nunca confía en la validación del navegador — el RUT y el resto
// de los campos se revalidan acá antes de tocar la base de datos.

import { createClient } from '@supabase/supabase-js';
import { rutValido, formatearRut } from '../../lib/rut.ts';
import { enviarCorreoParticipacionGratisCampana } from '../../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
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

    if (nombre.length < 3) return jsonResponse(400, { error: 'nombre_invalido' });
    if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: 'email_invalido' });
    if (telefono.replace(/\D/g, '').length < 8) return jsonResponse(400, { error: 'telefono_invalido' });
    if (!rutValido(rutCrudo)) return jsonResponse(400, { error: 'rut_invalido' });
    if (!aceptaBases) return jsonResponse(400, { error: 'debe_aceptar_las_bases' });

    const rut = formatearRut(rutCrudo);
    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase.rpc('fn_registrar_entrada_gratis_campana', {
      p_nombre: nombre,
      p_rut: rut,
      p_email: email,
      p_telefono: telefono,
    });

    if (error) {
      if (error.message.includes('rut_ya_participa')) {
        return jsonResponse(409, { error: 'rut_ya_participa' });
      }
      return jsonResponse(500, { error: 'no_se_pudo_registrar', detalle: error.message });
    }

    const entrada = Array.isArray(data) ? data[0] : data;
    const codigo = entrada?.codigo as string | undefined;

    if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_CAMPANA || context.env.EMAIL_FROM) && codigo) {
      try {
        await enviarCorreoParticipacionGratisCampana(
          context.env.RESEND_API_KEY,
          context.env.EMAIL_FROM_CAMPANA ?? context.env.EMAIL_FROM!,
          { nombre, email, codigo },
          [],
        );
      } catch (err) {
        console.error('email_participacion_gratis_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
      }
    }

    return jsonResponse(200, { codigo: codigo ?? null });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
