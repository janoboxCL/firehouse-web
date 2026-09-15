/// <reference types="@cloudflare/workers-types" />
// POST /api/registro-star/flow-webhook — urlConfirmation que recibe Flow
// para los pagos del Kit de Iniciación Firehouse Star.
//
// Nunca confía en la notificación por sí sola: vuelve a preguntarle a Flow
// el estado real (provider.obtenerEstadoPago) antes de confirmar nada.
// Mismo patrón que functions/api/campana-2026/flow-webhook.ts.

import { createClient } from '@supabase/supabase-js';
import { construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';
import { enviarCorreoConfirmacionStar, resolverBcc } from '../../lib/resend.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_STAR?: string;
  EMAIL_BCC?: string;
  SITE_URL?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      // 500 hace que Flow reintente más tarde — mejor que perder la notificación.
      return new Response('faltan variables de entorno', { status: 500 });
    }

    let provider;
    try {
      provider = construirPaymentProvider('FLOW', context.env);
    } catch (e) {
      return new Response(`pasarela mal configurada: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }

    const verificacion = await provider.verificarNotificacion(context.request);
    if (!verificacion.valida || !verificacion.referenciaPago) {
      return new Response(`notificacion invalida: ${verificacion.motivoRechazo ?? 'desconocido'}`, { status: 400 });
    }

    let estado;
    try {
      estado = await provider.obtenerEstadoPago(verificacion.referenciaPago);
    } catch {
      return new Response('no se pudo confirmar con flow', { status: 502 });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    if (estado.estado === 'APROBADO') {
      const { error: errConfirmar } = await supabase.rpc('fn_confirmar_pago_star', {
        p_commerce_order: estado.commerceOrder,
        p_pasarela: 'FLOW',
        p_pasarela_payment_id: estado.pasarelaPaymentId,
        p_monto: estado.monto,
        p_moneda: estado.moneda,
        p_metodo_pago: estado.metodoPago,
        p_datos_json: estado.datosCrudos,
      });
      if (errConfirmar) {
        console.error('fn_confirmar_pago_star_error', errConfirmar.message);
        return new Response('no se pudo confirmar el pago', { status: 500 });
      }

      if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_STAR || context.env.EMAIL_FROM)) {
        try {
          const { data: orden } = await supabase
            .from('star_ordenes')
            .select('id, apoderado_nombre, apoderado_email, atleta_nombre, monto, commerce_order')
            .eq('commerce_order', estado.commerceOrder)
            .single();

          if (orden) {
            await enviarCorreoConfirmacionStar(
              context.env.RESEND_API_KEY,
              context.env.EMAIL_FROM_STAR ?? context.env.EMAIL_FROM!,
              {
                apoderadoNombre: orden.apoderado_nombre,
                apoderadoEmail: orden.apoderado_email,
                atletaNombre: orden.atleta_nombre,
                monto: orden.monto,
                commerceOrder: orden.commerce_order,
                ordenId: orden.id,
              },
              resolverBcc(context.env.EMAIL_BCC),
            );
          }
        } catch (err) {
          console.error('email_confirmacion_star_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else if (estado.estado === 'REEMBOLSADO') {
      await supabase.rpc('fn_marcar_pago_reembolsado_star', { p_commerce_order: estado.commerceOrder, p_pasarela: 'FLOW' });
    } else {
      await supabase.rpc('fn_marcar_pago_no_aprobado_star', {
        p_commerce_order: estado.commerceOrder,
        p_pasarela: 'FLOW',
        p_estado_pago: estado.estado === 'PENDIENTE' ? 'PENDIENTE' : 'RECHAZADO',
      });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error_inesperado: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
};
