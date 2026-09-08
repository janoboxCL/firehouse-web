/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/flow-webhook — urlConfirmation que recibe Flow.
//
// Flow envía sólo un "token" por POST. NUNCA hay que confiar en eso solo: hay
// que volver a preguntarle a Flow el estado real con ese token antes de
// confirmar la orden (mismo criterio que /api/sorteo/flow-webhook).
//
// Cuando el pago se confirma, fn_confirmar_orden_campana genera un código de
// participación por cada producto de la orden (idempotente: si Flow reintenta
// la notificación, no duplica códigos), y se envía el correo real al
// comprador con el link de descarga (best effort: si Resend falla, no
// revierte el pago, que ya quedó guardado — sólo se pierde el correo).

import { createClient } from '@supabase/supabase-js';
import { obtenerEstadoPagoFlow } from '../../lib/flow.ts';
import { enviarCorreoConfirmacionCampana } from '../../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FLOW_API_KEY: string;
  FLOW_SECRET_KEY: string;
  FLOW_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
  SITE_URL?: string;
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

    const creds = { apiKey: context.env.FLOW_API_KEY, secretKey: context.env.FLOW_SECRET_KEY, baseUrl: context.env.FLOW_BASE_URL };

    let estado;
    try {
      estado = await obtenerEstadoPagoFlow(creds, token);
    } catch {
      return new Response('no se pudo confirmar con flow', { status: 502 });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    if (estado.status === 2) {
      const { data: entradas, error: errConfirmar } = await supabase.rpc('fn_confirmar_orden_campana', {
        p_commerce_order: estado.commerceOrder,
      });
      if (errConfirmar) {
        console.error('fn_confirmar_orden_campana_error', errConfirmar.message);
        return new Response('no se pudo confirmar la orden', { status: 500 });
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
              [], // sin copia oculta: solo al comprador
            );
          }
        } catch (err) {
          console.error('email_confirmacion_campana_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else {
      // status 1 = pendiente (no debería llegar acá todavía), 3/4 = rechazada/anulada.
      await supabase.rpc('fn_marcar_orden_no_pagada_campana', {
        p_commerce_order: estado.commerceOrder,
        p_estado: 'RECHAZADA',
      });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error_inesperado: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
};
