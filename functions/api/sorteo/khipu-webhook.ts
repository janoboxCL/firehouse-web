/// <reference types="@cloudflare/workers-types" />
// POST /api/sorteo/khipu-webhook — notify_url que recibe Khipu.
//
// Igual que con Flow: nunca hay que confiar en el cuerpo del aviso tal cual.
// Acá se usa solo para identificar CUÁL venta (por transaction_id = nuestro
// commerce_order), y con el khipu_payment_id que guardamos nosotros mismos al
// crear el pago se vuelve a preguntar a Khipu — con nuestra propia x-api-key —
// cuál es el estado real antes de confirmar nada.
//
// ⚠️ El formato exacto del cuerpo que Khipu envía en la notificación 3.0 no
// quedó 100% confirmado en la documentación pública al momento de escribir
// esto. Se intenta leer transaction_id tanto de JSON como de form-data, con
// varios nombres de campo posibles. Si en la primera prueba real esto no
// matchea, hay que ajustar según lo que se vea en los logs de Cloudflare.

import { createClient } from '@supabase/supabase-js';
import { obtenerEstadoPagoKhipu } from '../../lib/khipu.ts';
import { enviarCorreoConfirmacionRifa } from '../../lib/resend.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  KHIPU_API_KEY: string;
  KHIPU_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM_CONCURSO?: string;
  EMAIL_FROM?: string;
}

async function extraerTransactionId(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      const directo = body.transaction_id ?? body.transactionId;
      if (typeof directo === 'string') return directo;
      // Algunos formatos anidan los datos del pago dentro de un objeto "payment" o "subject".
      const anidado = (body.payment as Record<string, unknown> | undefined)?.transaction_id;
      if (typeof anidado === 'string') return anidado;
      return null;
    }
    const form = await request.formData();
    const valor = form.get('transaction_id') ?? form.get('notification_token');
    return typeof valor === 'string' ? valor : null;
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY || !context.env.KHIPU_API_KEY || !context.env.KHIPU_BASE_URL) {
      return new Response('faltan variables de entorno', { status: 500 });
    }

    const transactionId = await extraerTransactionId(context.request.clone());
    if (!transactionId) {
      return new Response('no se pudo identificar la transacción', { status: 400 });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: venta } = await supabase
      .from('rifa_ventas')
      .select('id, khipu_payment_id')
      .eq('commerce_order', transactionId)
      .maybeSingle();

    if (!venta?.khipu_payment_id) {
      return new Response('venta no encontrada', { status: 404 });
    }

    const creds = { apiKey: context.env.KHIPU_API_KEY, baseUrl: context.env.KHIPU_BASE_URL };
    const estado = await obtenerEstadoPagoKhipu(creds, venta.khipu_payment_id);

    if (estado.status === 'done') {
      await supabase.rpc('fn_confirmar_pago_rifa', {
        p_commerce_order: transactionId,
        p_flow_order: null,
        p_flow_payment_data: { pasarela: 'KHIPU', khipu_payment_id: estado.paymentId, status: estado.status },
      });

      if (context.env.RESEND_API_KEY && (context.env.EMAIL_FROM_CONCURSO || context.env.EMAIL_FROM)) {
        try {
          const { data: ventaCompleta } = await supabase
            .from('rifa_ventas')
            .select('id, comprador_nombre, comprador_email, monto')
            .eq('commerce_order', transactionId)
            .single();

          if (ventaCompleta) {
            const [{ data: numerosVendidos }, { data: config }] = await Promise.all([
              supabase.from('rifa_numeros').select('numero').eq('venta_id', ventaCompleta.id),
              supabase.from('rifa_config').select('fecha_sorteo').eq('id', 1).single(),
            ]);

            await enviarCorreoConfirmacionRifa(
              context.env.RESEND_API_KEY,
              context.env.EMAIL_FROM_CONCURSO ?? context.env.EMAIL_FROM!,
              {
                compradorNombre: ventaCompleta.comprador_nombre,
                compradorEmail: ventaCompleta.comprador_email,
                numeros: (numerosVendidos ?? []).map((n) => n.numero),
                monto: ventaCompleta.monto,
                commerceOrder: transactionId,
                fechaSorteo: config?.fecha_sorteo ?? null,
              },
              [], // sin copia oculta: solo al comprador
            );
          }
        } catch (err) {
          console.error('email_confirmacion_concurso_khipu_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
        }
      }
    } else {
      await supabase.rpc('fn_marcar_venta_no_pagada_rifa', { p_commerce_order: transactionId, p_estado: 'RECHAZADA' });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(`error_inesperado: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
};
