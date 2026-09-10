/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/crear-orden
//
// Crea la ORDER (campana_ordenes + campana_orden_items + campana_entregas en
// LOCKED), crea el intento de PAYMENT (campana_pagos, PENDIENTE) y arma el
// pago en la pasarela habilitada — sin saber si es Flow o Mercado Pago:
// eso lo decide functions/lib/payment-providers/index.ts.
//
// El precio SIEMPRE se recalcula acá con un mapa fijo — nunca se confía en
// un monto que mande el navegador.
//
// Mientras no haya ninguna pasarela con habilitada=true en campana_pasarelas,
// responde 403 {error:'checkout_deshabilitado'} y el frontend muestra el
// aviso de "medio de pago en proceso de validación".

import { createClient } from '@supabase/supabase-js';
import { elegirPasarelaHabilitada, construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';
import { NOMBRE_PRODUCTO_CAMPANA } from '../../lib/resend.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE_URL?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRECIOS: Record<string, number> = { BLAZE: 3000, NOVA: 3000, BLAZE_NOVA: 5000 };
const PRODUCTOS_VALIDOS = new Set(Object.keys(PRECIOS));

const WEBHOOK_POR_PASARELA: Record<string, string> = {
  FLOW: '/api/campana-2026/flow-webhook',
  MERCADOPAGO: '/api/mercadopago/webhook',
};

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

    const productosCrudos = Array.isArray(body.productos) ? body.productos : [];
    const productos = [...new Set(productosCrudos.map((p) => String(p).toUpperCase()))].filter((p) =>
      PRODUCTOS_VALIDOS.has(p),
    );

    const comprador = (body.comprador ?? {}) as Record<string, unknown>;
    const nombre = String(comprador.nombre ?? '').trim().slice(0, 150);
    const email = String(comprador.email ?? '').trim().slice(0, 254);
    const telefono = String(comprador.telefono ?? '').trim().slice(0, 20);
    const refTexto = body.ref ? String(body.ref).trim().slice(0, 12) : null;

    if (productos.length === 0 || productos.length > 3) {
      return jsonResponse(400, { error: 'productos_invalidos' });
    }
    if (!nombre || !EMAIL_RE.test(email) || telefono.replace(/\D/g, '').length < 8) {
      return jsonResponse(400, { error: 'datos_comprador_invalidos' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: config, error: errConfig } = await supabase
      .from('campana_config')
      .select('checkout_habilitado')
      .eq('id', 1)
      .single();
    if (errConfig || !config) {
      return jsonResponse(500, { error: 'config_no_disponible', detalle: errConfig?.message ?? 'sin fila en campana_config' });
    }
    if (!config.checkout_habilitado) {
      return jsonResponse(403, { error: 'checkout_deshabilitado' });
    }

    const pasarelaId = await elegirPasarelaHabilitada(supabase);
    if (!pasarelaId) {
      return jsonResponse(403, { error: 'checkout_deshabilitado' });
    }

    let provider;
    try {
      provider = construirPaymentProvider(pasarelaId, context.env);
    } catch (e) {
      return jsonResponse(500, { error: 'pasarela_mal_configurada', detalle: e instanceof Error ? e.message : String(e) });
    }

    let rifaCodigoId: string | null = null;
    if (refTexto) {
      const { data: codigo } = await supabase.from('rifa_codigos').select('id').eq('codigo', refTexto).maybeSingle();
      rifaCodigoId = codigo?.id ?? null;
    }

    const monto = productos.reduce((acc, p) => acc + PRECIOS[p], 0);
    const commerceOrder = `CAMPANA2026-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

    const { data: orden, error: errOrden } = await supabase
      .from('campana_ordenes')
      .insert({
        commerce_order: commerceOrder,
        comprador_nombre: nombre,
        comprador_email: email,
        comprador_telefono: telefono,
        rifa_codigo_id: rifaCodigoId,
        monto,
      })
      .select('id')
      .single();
    if (errOrden || !orden) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_la_orden', detalle: errOrden?.message });
    }

    const { data: items, error: errItems } = await supabase
      .from('campana_orden_items')
      .insert(productos.map((p) => ({ orden_id: orden.id, producto: p, precio: PRECIOS[p] })))
      .select('id');
    if (errItems || !items) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_los_items', detalle: errItems?.message });
    }

    const { error: errEntregas } = await supabase
      .from('campana_entregas')
      .insert(items.map((i) => ({ orden_item_id: i.id, estado: 'LOCKED' })));
    if (errEntregas) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_la_entrega', detalle: errEntregas.message });
    }

    const { error: errPago } = await supabase
      .from('campana_pagos')
      .insert({ orden_id: orden.id, pasarela: pasarelaId, monto, moneda: 'CLP', estado: 'PENDIENTE' });
    if (errPago) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_el_pago', detalle: errPago.message });
    }

    const siteUrl = context.env.SITE_URL ?? 'https://firehousecheer.cl';
    const urlDescarga = `${siteUrl}/campana-2026/descarga?orden=${orden.id}`;

    try {
      const preferencia = await provider.crearPreferencia({
        commerceOrder,
        items: productos.map((p) => ({ producto: p, nombre: NOMBRE_PRODUCTO_CAMPANA[p] ?? p, precio: PRECIOS[p] })),
        email,
        urlWebhook: `${siteUrl}${WEBHOOK_POR_PASARELA[pasarelaId]}`,
        // Las tres apuntan al mismo lugar a propósito: esa página nunca
        // confía en la URL de retorno, siempre vuelve a preguntarle al
        // backend el estado real de la orden (ver /campana-2026/descarga).
        urlExito: urlDescarga,
        urlPendiente: urlDescarga,
        urlError: urlDescarga,
      });

      await supabase.from('campana_pagos').update({ referencia_externa: preferencia.referenciaExterna }).eq('orden_id', orden.id).eq('pasarela', pasarelaId);

      return jsonResponse(200, { url: preferencia.urlPago });
    } catch (e) {
      await supabase.rpc('fn_marcar_pago_no_aprobado_campana', {
        p_commerce_order: commerceOrder,
        p_pasarela: pasarelaId,
        p_estado_pago: 'ANULADO',
        p_estado_orden: 'ANULADA',
      });
      return jsonResponse(502, { error: 'pasarela_no_disponible', detalle: e instanceof Error ? e.message : 'desconocido' });
    }
  } catch (e) {
    return jsonResponse(500, {
      error: 'error_inesperado',
      detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
  }
};
