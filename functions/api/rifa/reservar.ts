/// <reference types="@cloudflare/workers-types" />
// POST /api/rifa/reservar
// Recibe los números elegidos + datos del comprador, reserva atómicamente en
// Supabase, y crea la orden de pago en Flow. Devuelve la URL a la que hay que
// redirigir al comprador para pagar.
//
// El precio SIEMPRE se recalcula acá con rifa_config — nunca se confía en un
// monto que mande el navegador.
//
// Toda la función corre dentro de un try/catch general: un error inesperado
// acá SIEMPRE debe volver como un JSON con detalle, nunca como un 502 opaco
// de Cloudflare sin ninguna pista de qué pasó.

import { createClient } from '@supabase/supabase-js';
import { crearPagoFlow } from '../../lib/flow.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FLOW_API_KEY: string;
  FLOW_SECRET_KEY: string;
  FLOW_BASE_URL: string;
  /** ej. https://firehousecheer.cl — si no está seteada, se usa ese valor por defecto. */
  SITE_URL?: string;
}

const VARIABLES_REQUERIDAS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FLOW_API_KEY', 'FLOW_SECRET_KEY', 'FLOW_BASE_URL'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NUMEROS_POR_COMPRA = 20;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

interface ReservaResultado {
  numero: number;
  reservado: boolean;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    // Falla rápido y con un mensaje claro si falta alguna variable de entorno,
    // en vez de dejar que un error opaco de una librería tumbe la función.
    const faltantes = VARIABLES_REQUERIDAS.filter((k) => !context.env[k]);
    if (faltantes.length > 0) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno', variables: faltantes });
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse(400, { error: 'json_invalido' });
    }

    const numerosCrudos = Array.isArray(body.numeros) ? body.numeros : [];
    const numeros = [...new Set(numerosCrudos.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];

    const comprador = (body.comprador ?? {}) as Record<string, unknown>;
    const nombre = String(comprador.nombre ?? '').trim().slice(0, 150);
    const email = String(comprador.email ?? '').trim().slice(0, 254);
    const telefono = String(comprador.telefono ?? '').trim().slice(0, 20);
    const instagram = String(comprador.instagram ?? '').trim().slice(0, 60) || null;
    const rut = String(comprador.rut ?? '').trim().slice(0, 12) || null;
    const rifaCodigoTexto = body.rifaCodigo ? String(body.rifaCodigo).trim().slice(0, 12) : null;

    if (numeros.length === 0 || numeros.length > MAX_NUMEROS_POR_COMPRA) {
      return jsonResponse(400, { error: 'cantidad_invalida' });
    }
    if (!nombre || !EMAIL_RE.test(email) || telefono.replace(/\D/g, '').length < 8) {
      return jsonResponse(400, { error: 'datos_comprador_invalidos' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: config, error: errConfig } = await supabase
      .from('rifa_config')
      .select('precio_uno, precio_pack')
      .eq('id', 1)
      .single();
    if (errConfig || !config) {
      return jsonResponse(500, { error: 'config_no_disponible', detalle: errConfig?.message ?? 'sin fila en rifa_config' });
    }

    const pares = Math.floor(numeros.length / 2);
    const resto = numeros.length % 2;
    const monto = pares * config.precio_pack + resto * config.precio_uno;

    let rifaCodigoId: string | null = null;
    if (rifaCodigoTexto) {
      const { data: codigo } = await supabase
        .from('rifa_codigos')
        .select('id')
        .eq('codigo', rifaCodigoTexto)
        .maybeSingle();
      rifaCodigoId = codigo?.id ?? null;
    }

    const commerceOrder = `RIFA-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

    const { data: venta, error: errVenta } = await supabase
      .from('rifa_ventas')
      .insert({
        commerce_order: commerceOrder,
        cantidad_numeros: numeros.length,
        monto,
        comprador_nombre: nombre,
        comprador_email: email,
        comprador_telefono: telefono,
        comprador_instagram: instagram,
        comprador_rut: rut,
        rifa_codigo_id: rifaCodigoId,
      })
      .select('id')
      .single();

    if (errVenta || !venta) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_la_venta', detalle: errVenta?.message });
    }

    const { data: reserva, error: errReserva } = await supabase.rpc('fn_reservar_numeros_rifa', {
      p_numeros: numeros,
      p_venta_id: venta.id,
    });

    if (errReserva) {
      return jsonResponse(500, { error: 'no_se_pudo_reservar', detalle: errReserva.message });
    }

    const noDisponibles = ((reserva ?? []) as ReservaResultado[]).filter((r) => !r.reservado).map((r) => r.numero);

    if (noDisponibles.length > 0) {
      await supabase.rpc('fn_marcar_venta_no_pagada_rifa', { p_commerce_order: commerceOrder, p_estado: 'ANULADA' });
      return jsonResponse(409, { error: 'numeros_no_disponibles', numeros: noDisponibles });
    }

    const siteUrl = context.env.SITE_URL ?? 'https://firehousecheer.cl';

    try {
      const pago = await crearPagoFlow(
        { apiKey: context.env.FLOW_API_KEY, secretKey: context.env.FLOW_SECRET_KEY, baseUrl: context.env.FLOW_BASE_URL },
        {
          commerceOrder,
          subject: `Rifa Firehouse - ${numeros.length} número${numeros.length > 1 ? 's' : ''}`,
          amount: monto,
          email,
          urlConfirmation: `${siteUrl}/api/rifa/flow-webhook`,
          urlReturn: `${siteUrl}/rifa/gracias?orden=${commerceOrder}`,
          optional: { rifaCodigo: rifaCodigoTexto ?? '', numeros: numeros.join(',') },
        },
      );

      await supabase.from('rifa_ventas').update({ flow_token: pago.token, flow_order: pago.flowOrder }).eq('id', venta.id);

      return jsonResponse(200, { url: `${pago.url}?token=${pago.token}` });
    } catch (e) {
      // Si Flow falla, no dejamos los números atrapados en RESERVADO 10 minutos por nada.
      await supabase.rpc('fn_marcar_venta_no_pagada_rifa', { p_commerce_order: commerceOrder, p_estado: 'ANULADA' });
      return jsonResponse(502, { error: 'flow_no_disponible', detalle: e instanceof Error ? e.message : 'desconocido' });
    }
  } catch (e) {
    return jsonResponse(500, {
      error: 'error_inesperado',
      detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
  }
};
