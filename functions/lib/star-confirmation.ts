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
  const remitente = env.EMAIL_FROM_STAR ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !remitente) {
    console.error('email_confirmacion_star_no_configurado', 'Falta RESEND_API_KEY o EMAIL_FROM_STAR/EMAIL_FROM');
    return 'no_configurado';
  }

  const { data: orden, error } = await supabase
    .from('star_ordenes')
    .select(
      'id, apoderado_nombre, apoderado_email, monto, commerce_order, correo_confirmacion_enviado_at, star_orden_atletas ( atleta_nombre )',
    )
    .eq('commerce_order', commerceOrder)
    .single();
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

  const { error: errorMarca } = await supabase
    .from('star_ordenes')
    .update({ correo_confirmacion_enviado_at: new Date().toISOString() })
    .eq('id', orden.id)
    .is('correo_confirmacion_enviado_at', null);
  if (errorMarca) console.error('email_confirmacion_star_marca_error', errorMarca.message);
  return 'enviado';
}
