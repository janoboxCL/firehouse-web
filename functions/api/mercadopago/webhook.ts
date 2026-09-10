/// <reference types="@cloudflare/workers-types" />
// POST /api/mercadopago/webhook
//
// Mercado Pago puede notificar varios tipos de evento (payment, merchant_order,
// chargebacks...) — sólo procesamos "payment"; el resto se responde 200 sin
// hacer nada, para que Mercado Pago no reintente por algo que no vamos a usar.
//
// Orden de operaciones, tal como exige la integración:
// 1. validar la firma (HMAC oficial, ver payment-providers/mercadopago.ts)
// 2. consultar el pago DIRECTO a la API de Mercado Pago (nunca confiar en el body de la notificación)
// 3. buscar la ORDEN por external_reference
// 4. validar monto y moneda (fn_confirmar_pago_campana aborta si no calzan)
// 5. confirmar de forma idempotente, liberar la entrega, enviar el correo

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
    const url = new URL(context.request.url);
    const tipo = url.searchParams.get('type') ?? url.searchParams.get('topic');
    if (tipo && tipo !== 'payment') {
      return new Response('ok (tipo no procesado)', { status: 200 });
    }

    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      // 500 hace que Mercado Pago reintente más tarde — mejor que perder la notificación.
      return new Response('faltan variables de entorno', { status: 500 });
    }

    let provider;
    try {
      provider = construirPaymentProvider('MERCADOPAGO', context.env);
    } catch (e) {
      return new Response(`pasarela mal configurada: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }

    const verificacion = await provider.verificarNotificacion(context.request);
    if (!verificacion.valida || !verificacion.referenciaPago) {
      // 401, no 400: una firma inválida es exactamente el caso que esta
      // verificación existe para rechazar (posible intento de fraude).
      return new Response(`notificacion invalida: ${verificacion.motivoRechazo ?? 'desconocido'}`, { status: 401 });
    }

    let estado;
    try {
      estado = await provider.obtenerEstadoPago(verificacion.referenciaPago);
    } catch {
      return new Response('no se pudo confirmar con mercado pago', { status: 502 });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    if (estado.estado === 'APROBADO') {
      const { data: entradas, error: errConfirmar } = await supabase.rpc('fn_confirmar_pago_campana', {
        p_commerce_order: estado.commerceOrder,
        p_pasarela: 'MERCADOPAGO',
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
            const productos = ((orden as unknown as { campana_orden_items: { producto: string }[] }).campana_orden_items ?? []).map(
              (i) => i.producto,
            );
            const codigos = ((entradas ?? []) as { codigo: string }[]).map((e) => e.codigo);
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
                siteUrl,
              },
              [],
            );
          }
        } catch (err) {
          console.error('email_confirmacion_campana_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else if (estado.estado === 'REEMBOLSADO') {
      await supabase.rpc('fn_marcar_pago_reembolsado_campana', { p_commerce_order: estado.commerceOrder, p_pasarela: 'MERCADOPAGO' });
    } else {
      await supabase.rpc('fn_marcar_pago_no_aprobado_campana', {
        p_commerce_order: estado.commerceOrder,
        p_pasarela: 'MERCADOPAGO',
        p_estado_pago: estado.estado === 'PENDIENTE' ? 'PENDIENTE' : 'RECHAZADO',
      });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error_inesperado: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
};
