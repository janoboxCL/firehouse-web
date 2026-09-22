/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/flow-webhook — urlConfirmation que recibe Flow.
//
// Nunca confía en la notificación por sí sola: vuelve a preguntarle a Flow
// el estado real (provider.obtenerEstadoPago) antes de confirmar nada.
// Toda la lógica específica de Flow vive en functions/lib/payment-providers/flow.ts
// — esto sólo orquesta: verificar → consultar → confirmar → entregar → avisar.

import { createClient } from '@supabase/supabase-js';
import { construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';
import { enviarCorreoConfirmacionCampana } from '../../lib/resend.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
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
      const { data: entradas, error: errConfirmar } = await supabase.rpc('fn_confirmar_pago_campana', {
        p_commerce_order: estado.commerceOrder,
        p_pasarela: 'FLOW',
        p_pasarela_payment_id: estado.pasarelaPaymentId,
        p_monto: estado.monto,
        p_moneda: estado.moneda,
        p_metodo_pago: estado.metodoPago,
        p_datos_json: estado.datosCrudos,
      });
      if (errConfirmar) {
        console.error('fn_confirmar_pago_campana_error', errConfirmar.message);
        return new Response('no se pudo confirmar el pago', { status: 500 });
      }

      if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_CAMPANA || context.env.EMAIL_FROM)) {
        try {
          const { data: orden } = await supabase
            .from('campana_ordenes')
            .select('id, comprador_nombre, comprador_email, monto, commerce_order, campana_orden_items ( producto )')
            .eq('commerce_order', estado.commerceOrder)
            .single();

          if (orden) {
            const { data: claimed } = await supabase.from('campana_email_outbox').update({ status: 'SENDING' })
              .eq('tipo', 'CONFIRMACION_COMPRA').eq('order_id', orden.id).eq('status', 'PENDING').select('id').maybeSingle();
            if (!claimed) return new Response('ok', { status: 200 });
            const productos = ((orden as unknown as { campana_orden_items: { producto: string }[] }).campana_orden_items ?? []).map(
              (i) => i.producto,
            );
            const resultado = (entradas ?? {}) as { codigos?: string[]; total?: number };
            const codigos = resultado.codigos ?? [];
            const siteUrl = context.env.SITE_URL ?? 'https://firehousecheer.cl';

            await enviarCorreoConfirmacionCampana(
              context.env.RESEND_API_KEY,
              context.env.EMAIL_FROM_CAMPANA ?? context.env.EMAIL_FROM!,
              {
                compradorNombre: orden.comprador_nombre,
                compradorEmail: orden.comprador_email,
                monto: orden.monto,
                commerceOrder: orden.commerce_order,
                ordenId: orden.id,
                productos,
                codigos,
                totalParticipaciones: resultado.total ?? codigos.length,
                siteUrl,
              },
              [],
            );
            await supabase.from('campana_email_outbox').update({ status: 'SENT', sent_at: new Date().toISOString(), attempts: 1 }).eq('id', claimed.id);
          }
        } catch (err) {
          console.error('email_confirmacion_campana_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else if (estado.estado === 'REEMBOLSADO') {
      await supabase.rpc('fn_marcar_pago_reembolsado_campana', { p_commerce_order: estado.commerceOrder, p_pasarela: 'FLOW' });
    } else {
      await supabase.rpc('fn_marcar_pago_no_aprobado_campana', {
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
