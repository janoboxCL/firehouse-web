/// <reference types="@cloudflare/workers-types" />
// POST /api/registro-star/crear-orden
//
// Crea el registro (apoderado + atleta + caso_crm + star_orden, todo en una
// transacción vía fn_crear_registro_star) y arma el cobro del Kit de
// Iniciación Firehouse Star ($10.000) con la pasarela habilitada.
//
// La pasarela es la MISMA que usa el resto de Firehouse (comparte
// configuración con la campaña 2026 vía elegirPasarelaHabilitada) — no hay
// un interruptor de pagos por feature, es uno solo para todo el sitio.
//
// El monto SIEMPRE se fija acá, en el servidor — nunca se confía en nada
// que mande el navegador.
//
// Ojo: esta es la primera de dos cobros. La mensualidad ($30.000, o el
// proporcional según la semana de ingreso) se cobra aparte, más cerca de la
// fecha de la primera clase — ese segundo cobro es trabajo pendiente, no
// está en este endpoint.

import { createClient } from '@supabase/supabase-js';
import { elegirPasarelaHabilitada, construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE_URL?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTO_KIT_STAR = 10000;
const MAX_ATLETAS = 5;
const NOMBRE_PRODUCTO_KIT = 'Kit de Iniciación Firehouse Star';

// Prefijo del commerce_order: así el webhook compartido de Mercado Pago
// (que también procesa pagos de la campaña 2026) sabe a qué tabla y qué
// función RPC llamar sin necesitar una columna ni una tabla nueva para
// diferenciarlo — el mismo criterio que ya usa "CAMPANA2026-" como prefijo.
const PREFIJO_COMMERCE_ORDER = 'STAR-';

const WEBHOOK_POR_PASARELA: Record<string, string> = {
  FLOW: '/api/registro-star/flow-webhook',
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

    const apoderado = (body.apoderado ?? {}) as Record<string, unknown>;
    const atletasCrudos = Array.isArray(body.atletas) ? body.atletas : [];

    const apNombre = String(apoderado.nombre ?? '').trim().slice(0, 80);
    const apApellidos = String(apoderado.apellidos ?? '').trim().slice(0, 120);
    const apTelefono = String(apoderado.telefono ?? '').trim().slice(0, 20);
    const apEmail = String(apoderado.email ?? '').trim().slice(0, 254);
    const apComuna = String(apoderado.comuna ?? '').trim().slice(0, 100);

    const aceptaCondiciones = body.aceptaCondiciones === true;

    if (!apNombre || apNombre.length < 2) {
      return jsonResponse(400, { error: 'nombre_apoderado_invalido' });
    }
    if (!apApellidos || apApellidos.length < 2) {
      return jsonResponse(400, { error: 'apellidos_apoderado_invalidos' });
    }
    if (!EMAIL_RE.test(apEmail)) {
      return jsonResponse(400, { error: 'email_invalido' });
    }
    if (apTelefono.replace(/\D/g, '').length < 8) {
      return jsonResponse(400, { error: 'telefono_invalido' });
    }
    if (!apComuna) {
      return jsonResponse(400, { error: 'comuna_invalida' });
    }
    if (atletasCrudos.length === 0 || atletasCrudos.length > MAX_ATLETAS) {
      return jsonResponse(400, { error: 'cantidad_atletas_invalida' });
    }

    const atletas: { nombre: string; apellidos: string; fechaNacimiento: string }[] = [];
    for (const raw of atletasCrudos) {
      const a = (raw ?? {}) as Record<string, unknown>;
      const atNombre = String(a.nombre ?? '').trim().slice(0, 80);
      const atApellidos = String(a.apellidos ?? '').trim().slice(0, 120);
      const atFechaNacimiento = String(a.fechaNacimiento ?? '').trim();

      if (!atNombre || atNombre.length < 2) {
        return jsonResponse(400, { error: 'nombre_atleta_invalido' });
      }
      if (!atFechaNacimiento || isNaN(Date.parse(atFechaNacimiento))) {
        return jsonResponse(400, { error: 'fecha_nacimiento_invalida' });
      }
      if (new Date(atFechaNacimiento) > new Date()) {
        return jsonResponse(400, { error: 'fecha_nacimiento_futura' });
      }
      atletas.push({ nombre: atNombre, apellidos: atApellidos, fechaNacimiento: atFechaNacimiento });
    }

    if (!aceptaCondiciones) {
      return jsonResponse(400, { error: 'debe_aceptar_condiciones' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

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

    const commerceOrder = `${PREFIJO_COMMERCE_ORDER}${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const montoTotal = MONTO_KIT_STAR * atletas.length;

    const { data: resultado, error: errRpc } = await supabase.rpc('fn_crear_registro_star', {
      payload: {
        commerceOrder,
        monto: montoTotal,
        apoderado: {
          nombre: apNombre,
          apellidos: apApellidos,
          telefono: apTelefono,
          email: apEmail,
          comuna: apComuna,
          privacyPolicyVersion: '2026-09',
        },
        atletas,
      },
    });
    if (errRpc || !resultado) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_el_registro', detalle: errRpc?.message });
    }

    const ordenId = (resultado as { ordenId: string }).ordenId;

    const { error: errPago } = await supabase
      .from('star_pagos')
      .insert({ orden_id: ordenId, pasarela: pasarelaId, monto: montoTotal, moneda: 'CLP', estado: 'PENDIENTE' });
    if (errPago) {
      return jsonResponse(500, { error: 'no_se_pudo_crear_el_pago', detalle: errPago.message });
    }

    const siteUrl = context.env.SITE_URL ?? 'https://firehousecheer.cl';
    const urlResultado = `${siteUrl}/registro-star/gracias?orden=${ordenId}`;

    try {
      const preferencia = await provider.crearPreferencia({
        commerceOrder,
        items: [{ producto: 'KIT_STAR', nombre: `${NOMBRE_PRODUCTO_KIT} (x${atletas.length})`, precio: montoTotal }],
        email: apEmail,
        urlWebhook: `${siteUrl}${WEBHOOK_POR_PASARELA[pasarelaId]}`,
        // Igual que en la campaña 2026: las tres apuntan al mismo lugar a
        // propósito — esa página nunca confía en la URL de retorno, siempre
        // vuelve a preguntarle al backend el estado real de la orden.
        urlExito: urlResultado,
        urlPendiente: urlResultado,
        urlError: urlResultado,
      });

      await supabase
        .from('star_pagos')
        .update({ referencia_externa: preferencia.referenciaExterna })
        .eq('orden_id', ordenId)
        .eq('pasarela', pasarelaId);

      return jsonResponse(200, { url: preferencia.urlPago });
    } catch (e) {
      await supabase.rpc('fn_marcar_pago_no_aprobado_star', {
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
