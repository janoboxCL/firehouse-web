import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarCorreoConfirmacionStar, resolverBcc } from './resend.ts';

export interface StarEmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_STAR?: string;
  EMAIL_BCC?: string;
}

/**
 * Envía (una sola vez) la confirmación del kit Star. Este helper se usa tanto
 * desde los webhooks como desde la reconciliación de la página de gracias: el
 * retorno del checkout puede confirmar el pago antes de que llegue el webhook.
 */
export async function enviarConfirmacionStarSiCorresponde(
  supabase: SupabaseClient,
  env: StarEmailEnv,
  commerceOrder: string,
): Promise<'enviado' | 'ya_enviado' | 'no_configurado' | 'orden_no_encontrada'> {
  // En Cloudflare una variable definida con valor vacío sigue siendo un
  // string válido para `??`. En ese caso debemos caer al remitente general,
  // no mandar un `from` vacío a Resend.
  const remitente = env.EMAIL_FROM_STAR?.trim() || env.EMAIL_FROM?.trim();
  if (!env.RESEND_API_KEY || !remitente) {
    console.error('email_confirmacion_star_no_configurado', 'Falta RESEND_API_KEY o EMAIL_FROM_STAR/EMAIL_FROM');
    return 'no_configurado';
  }

  let { data: orden, error } = await supabase
    .from('star_ordenes')
    .select(
      'id, apoderado_nombre, apoderado_email, monto, commerce_order, correo_confirmacion_enviado_at, star_orden_atletas ( atleta_nombre )',
    )
    .eq('commerce_order', commerceOrder)
    .single();

  // La confirmación de pago no depende de que la migración del marcador de
  // idempotencia ya haya llegado a producción. Esto es especialmente
  // importante para Mercado Pago: el webhook puede marcar la orden PAGADA y
  // la página de retorno entrar inmediatamente después, durante un despliegue
  // escalonado. PostgREST informa una columna inexistente como 42703 (o
  // PGRST204 si aún conserva el schema cache anterior).
  const faltaColumnaMarcador = error && (error.code === '42703' || error.code === 'PGRST204');
  if (faltaColumnaMarcador) {
    console.warn('email_confirmacion_star_sin_marcador', 'Aplicar migración 0002_star_confirmacion_email.sql');
    const resultadoSinMarcador = await supabase
      .from('star_ordenes')
      .select('id, apoderado_nombre, apoderado_email, monto, commerce_order, star_orden_atletas ( atleta_nombre )')
      .eq('commerce_order', commerceOrder)
      .single();
    orden = resultadoSinMarcador.data ? { ...resultadoSinMarcador.data, correo_confirmacion_enviado_at: null } : null;
    error = resultadoSinMarcador.error;
  }
  if (error || !orden) {
    if (error) console.error('email_confirmacion_star_orden_error', error.message);
    return 'orden_no_encontrada';
  }
  if (orden.correo_confirmacion_enviado_at) return 'ya_enviado';

  const atletaNombres = ((orden as unknown as { star_orden_atletas: { atleta_nombre: string }[] }).star_orden_atletas ?? []).map(
    (a) => a.atleta_nombre,
  );
  await enviarCorreoConfirmacionStar(
    env.RESEND_API_KEY,
    remitente,
    {
      apoderadoNombre: orden.apoderado_nombre,
      apoderadoEmail: orden.apoderado_email,
      atletaNombres,
      monto: orden.monto,
      commerceOrder: orden.commerce_order,
      ordenId: orden.id,
    },
    resolverBcc(env.EMAIL_BCC),
  );

  if (!faltaColumnaMarcador) {
    const { error: errorMarca } = await supabase
      .from('star_ordenes')
      .update({ correo_confirmacion_enviado_at: new Date().toISOString() })
      .eq('id', orden.id)
      .is('correo_confirmacion_enviado_at', null);
    if (errorMarca) console.error('email_confirmacion_star_marca_error', errorMarca.message);
  }
  return 'enviado';
}
