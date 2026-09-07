/// <reference types="@cloudflare/workers-types" />
// POST /api/sorteo/flow-webhook — urlConfirmation que recibe Flow.
//
// Flow envía sólo un "token" por POST. NUNCA hay que confiar en eso solo: hay
// que volver a preguntarle a Flow el estado real con ese token antes de marcar
// algo como pagado (por si alguien intenta llamar a esta URL directamente).
//
// Cuando el pago se confirma, se envía el correo real al comprador con sus
// tickets (best effort: si Resend falla, no revierte el pago, que ya quedó
// guardado — sólo se pierde el correo, no la venta).

import { createClient } from '@supabase/supabase-js';
import { obtenerEstadoPagoFlow } from '../../lib/flow.ts';
import { enviarCorreoConfirmacionRifa } from '../../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FLOW_API_KEY: string;
  FLOW_SECRET_KEY: string;
  FLOW_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CONCURSO?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (
      !context.env.SUPABASE_URL ||
      !context.env.SUPABASE_SERVICE_ROLE_KEY ||
      !context.env.FLOW_API_KEY ||
      !context.env.FLOW_SECRET_KEY ||
      !context.env.FLOW_BASE_URL
    ) {
      // Responder 500 acá hace que Flow reintente más tarde — mejor que perder la notificación.
      return new Response('faltan variables de entorno', { status: 500 });
    }

    const form = await context.request.formData().catch(() => null);
    const token = form?.get('token');

    if (!token || typeof token !== 'string') {
      return new Response('falta token', { status: 400 });
    }

    const creds = {
      apiKey: context.env.FLOW_API_KEY,
      secretKey: context.env.FLOW_SECRET_KEY,
      baseUrl: context.env.FLOW_BASE_URL,
    };

    let estado;
    try {
      estado = await obtenerEstadoPagoFlow(creds, token);
    } catch {
      // Si Flow no responde ahora mismo, no confirmamos nada. Flow reintenta la
      // notificación más tarde si no recibe una respuesta 200 de esta URL.
      return new Response('no se pudo confirmar con flow', { status: 502 });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    if (estado.status === 2) {
      await supabase.rpc('fn_confirmar_pago_rifa', {
        p_commerce_order: estado.commerceOrder,
        p_flow_order: estado.flowOrder,
        p_flow_payment_data: estado.paymentData ?? {},
      });

      // Correo de confirmación al comprador (best effort — nunca rompe la confirmación del pago).
      // Solo al comprador, sin copia oculta, y desde el remitente propio del concurso.
      if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_CONCURSO || context.env.EMAIL_FROM)) {
        try {
          const { data: venta } = await supabase
            .from('rifa_ventas')
            .select('id, comprador_nombre, comprador_email, monto')
            .eq('commerce_order', estado.commerceOrder)
            .single();

          if (venta) {
            const [{ data: numerosVendidos }, { data: config }] = await Promise.all([
              supabase.from('rifa_numeros').select('numero').eq('venta_id', venta.id),
              supabase.from('rifa_config').select('fecha_sorteo').eq('id', 1).single(),
            ]);

            await enviarCorreoConfirmacionRifa(
              context.env.RESEND_API_KEY,
              context.env.EMAIL_FROM_CONCURSO ?? context.env.EMAIL_FROM!,
              {
                compradorNombre: venta.comprador_nombre,
                compradorEmail: venta.comprador_email,
                numeros: (numerosVendidos ?? []).map((n) => n.numero),
                monto: venta.monto,
                commerceOrder: estado.commerceOrder,
                fechaSorteo: config?.fecha_sorteo ?? null,
              },
              [], // sin copia oculta: solo al comprador
            );
          }
        } catch (err) {
          console.error('email_confirmacion_sorteo_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else {
      // status 1 = pendiente (no debería llegar acá todavía), 3/4 = rechazada/anulada.
      await supabase.rpc('fn_marcar_venta_no_pagada_rifa', {
        p_commerce_order: estado.commerceOrder,
        p_estado: 'RECHAZADA',
      });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error_inesperado: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
};
