/// <reference types="@cloudflare/workers-types" />
// POST /api/campana-2026/crear-orden
// Recibe los sobres elegidos + datos del comprador, crea la orden en Supabase
// y arma el pago en Flow. Devuelve la URL a la que hay que redirigir para pagar.
//
// El precio SIEMPRE se recalcula acá con un mapa fijo — nunca se confía en un
// monto que mande el navegador (mismo criterio que /api/sorteo/reservar).
//
// Mientras campana_config.checkout_habilitado sea false (default hasta que
// Flow apruebe el modelo nuevo), este endpoint responde 403 con
// {error:'checkout_deshabilitado'} y el frontend muestra el aviso de "medio
// de pago en proceso de validación" en vez de intentar cobrar.

import { createClient } from '@supabase/supabase-js';
import { crearPagoFlow } from '../../lib/flow.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FLOW_API_KEY?: string;
  FLOW_SECRET_KEY?: string;
  FLOW_BASE_URL?: string;
  /** ej. https://firehousecheer.cl — si no está seteada, se usa ese valor por defecto. */
  SITE_URL?: string;
}

const VARIABLES_BASE = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRECIOS: Record<string, number> = { BLAZE: 3000, NOVA: 3000, BLAZE_NOVA: 5000 };
const PRODUCTOS_VALIDOS = new Set(Object.keys(PRECIOS));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const faltantes = VARIABLES_BASE.filter((k) => !context.env[k]);
    if (faltantes.length > 0) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno', variables: faltantes });
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
      .select('checkout_habilitado, pasarela_activa')
      .eq('id', 1)
      .single();
    if (errConfig || !config) {
      return jsonResponse(500, { error: 'config_no_disponible', detalle: errConfig?.message ?? 'sin fila en campana_config' });
    }
    if (!config.checkout_habilitado) {
      return jsonResponse(403, { error: 'checkout_deshabilitado' });
    }
    if (config.pasarela_activa !== 'FLOW') {
      // El modelo está listo para más de una pasarela, pero por ahora sólo
      // implementamos el flujo de Flow acá.
      return jsonResponse(500, { error: 'pasarela_no_soportada', pasarela: config.pasarela_activa });
    }
    if (!context.env.FLOW_API_KEY || !context.env.FLOW_SECRET_KEY || !context.env.FLOW_BASE_URL) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno', variables: ['FLOW_API_KEY', 'FLOW_SECRET_KEY', 'FLOW_BASE_URL'] });
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
        pasarela: 'FLOW',
      })
      .select('id')
      .single();
    if (errOrden || !orden) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_la_orden', detalle: errOrden?.message });
    }

    const { error: errItems } = await supabase
      .from('campana_orden_items')
      .insert(productos.map((p) => ({ orden_id: orden.id, producto: p, precio: PRECIOS[p] })));
    if (errItems) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_los_items', detalle: errItems.message });
    }

    const siteUrl = context.env.SITE_URL ?? 'https://firehousecheer.cl';
    const asunto = `Campaña Firehouse 2026 - ${productos.length} sobre${productos.length > 1 ? 's' : ''}`;

    try {
      const pago = await crearPagoFlow(
        { apiKey: context.env.FLOW_API_KEY, secretKey: context.env.FLOW_SECRET_KEY, baseUrl: context.env.FLOW_BASE_URL },
        {
          commerceOrder,
          subject: asunto,
          amount: monto,
          email,
          urlConfirmation: `${siteUrl}/api/campana-2026/flow-webhook`,
          urlReturn: `${siteUrl}/campana-2026/descarga?orden=${orden.id}`,
          optional: { codigo: refTexto ?? '', productos: productos.join(',') },
        },
      );

      await supabase.from('campana_ordenes').update({ flow_token: pago.token, flow_order: String(pago.flowOrder) }).eq('id', orden.id);

      return jsonResponse(200, { url: `${pago.url}?token=${pago.token}` });
    } catch (e) {
      await supabase.rpc('fn_marcar_orden_no_pagada_campana', { p_commerce_order: commerceOrder, p_estado: 'ANULADA' });
      return jsonResponse(502, { error: 'pasarela_no_disponible', detalle: e instanceof Error ? e.message : 'desconocido' });
    }
  } catch (e) {
    return jsonResponse(500, {
      error: 'error_inesperado',
      detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
  }
};
