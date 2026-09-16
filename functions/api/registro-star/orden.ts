/// <reference types="@cloudflare/workers-types" />
// GET /api/registro-star/orden?orden=<uuid>
//
// Endpoint de solo lectura para la página de gracias. Igual que
// /api/campana-2026/orden: nunca confía en la URL de retorno de la
// pasarela, siempre vuelve a preguntar acá el estado real de la orden.
// El UUID funciona como el "secreto" de acceso — sólo lo recibe el
// apoderado, en la URL a la que la pasarela redirige tras el pago.

import { createClient } from '@supabase/supabase-js';
import { construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface OrdenStar {
  id: string;
  estado: string;
  commerce_order: string;
  apoderado_nombre: string;
  monto: number;
  star_orden_atletas: { atleta_nombre: string }[];
}

interface PagoStar {
  pasarela: 'FLOW' | 'MERCADOPAGO';
  referencia_externa: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respuestaPagada(orden: OrdenStar): Response {
  const atletaNombres = (orden.star_orden_atletas ?? []).map((a) => a.atleta_nombre);
  return jsonResponse(200, {
    estado: 'PAGADA',
    apoderadoNombre: orden.apoderado_nombre,
    atletaNombres,
    monto: orden.monto,
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
    }

    const ordenId = new URL(context.request.url).searchParams.get('orden')?.trim() ?? '';
    if (!UUID_RE.test(ordenId)) {
      return jsonResponse(400, { error: 'orden_invalida' });
    }

    const pagoRetorno = new URL(context.request.url).searchParams.get('pago')?.trim() ?? '';
    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: orden, error } = await supabase
      .from('star_ordenes')
      .select('id, estado, commerce_order, apoderado_nombre, monto, star_orden_atletas ( atleta_nombre )')
      .eq('id', ordenId)
      .maybeSingle();

    if (error) return jsonResponse(500, { error: 'no_se_pudo_consultar', detalle: error.message });
    if (!orden) return jsonResponse(404, { error: 'orden_no_encontrada' });

    const ordenStar = orden as unknown as OrdenStar;
    if (ordenStar.estado === 'PAGADA') return respuestaPagada(ordenStar);

    // El retorno del checkout puede ganarle al webhook. En ese caso no nos
    // limitamos a esperar: consultamos la pasarela directamente y aplicamos
    // la confirmación idempotente de Star. La comparación exacta del
    // commerce_order (incluido su prefijo STAR-) impide que un pago de la
    // campaña pueda confirmar accidentalmente una inscripción Star.
    if (ordenStar.estado === 'PENDIENTE') {
      const { data: pago } = await supabase
        .from('star_pagos')
        .select('pasarela, referencia_externa')
        .eq('orden_id', ordenId)
        .eq('estado', 'PENDIENTE')
        .limit(1)
        .maybeSingle();

      const pagoStar = pago as PagoStar | null;
      // Flow se consulta con el token guardado al crear el cobro. Mercado
      // Pago entrega el payment_id en la URL de retorno; su preference_id
      // guardado no sirve para consultar /v1/payments.
      const referencia = pagoStar?.pasarela === 'MERCADOPAGO' ? pagoRetorno : pagoStar?.referencia_externa;
      if (pagoStar && referencia) {
        try {
          const provider = construirPaymentProvider(pagoStar.pasarela, context.env);
          const estadoPago = await provider.obtenerEstadoPago(referencia);
          if (estadoPago.commerceOrder === ordenStar.commerce_order && estadoPago.commerceOrder.startsWith('STAR-')) {
            if (estadoPago.estado === 'APROBADO') {
              const { error: errorConfirmar } = await supabase.rpc('fn_confirmar_pago_star', {
                p_commerce_order: estadoPago.commerceOrder,
                p_pasarela: pagoStar.pasarela,
                p_pasarela_payment_id: estadoPago.pasarelaPaymentId,
                p_monto: estadoPago.monto,
                p_moneda: estadoPago.moneda,
                p_metodo_pago: estadoPago.metodoPago,
                p_datos_json: estadoPago.datosCrudos,
              });
              if (!errorConfirmar) return respuestaPagada(ordenStar);
              console.error('reconciliar_pago_star_error', errorConfirmar.message);
            } else if (estadoPago.estado !== 'PENDIENTE') {
              await supabase.rpc('fn_marcar_pago_no_aprobado_star', {
                p_commerce_order: estadoPago.commerceOrder,
                p_pasarela: pagoStar.pasarela,
                p_estado_pago: 'RECHAZADO',
              });
              return jsonResponse(409, { estado: 'RECHAZADA' });
            }
          } else {
            console.error('reconciliar_pago_star_orden_incorrecta', estadoPago.commerceOrder);
          }
        } catch (e) {
          // El webhook aún puede completar la orden. Una caída momentánea de
          // la pasarela no convierte un pago posiblemente exitoso en error.
          console.error('reconciliar_pago_star_no_disponible', e instanceof Error ? e.message : String(e));
        }
      }
    }

    if (ordenStar.estado !== 'PENDIENTE') return jsonResponse(409, { estado: ordenStar.estado });
    return jsonResponse(202, { estado: 'PENDIENTE' });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
