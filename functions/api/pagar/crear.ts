// POST /api/pagar/crear  { t: TOKEN, cargos: [ids] }
// Crea el pago por el saldo completo de los conceptos elegidos y devuelve la URL
// de Mercado Pago. Los montos salen de la base, nunca del navegador.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { apoderadoPorToken, estadoCuenta } from '../../lib/cuenta-servidor.ts';
import { construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';
import { cargosPagables, generarCommerceOrder, tokenValido, validarSeleccion } from '../../../src/lib/crm/cuenta.ts';
import { hoyChile } from '../../../src/lib/crm/programas.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE_URL?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  const token = cuerpo.t;
  const ids = Array.isArray(cuerpo.cargos) ? cuerpo.cargos.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  if (!tokenValido(token)) return jsonResponse(404, { error: 'link_invalido' });

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const apoderadoId = await apoderadoPorToken(supabase, token);
  if (!apoderadoId) return jsonResponse(404, { error: 'link_invalido' });

  const cuenta = await estadoCuenta(supabase, apoderadoId);
  const pagables = cargosPagables(cuenta.cargos, hoyChile());
  const validacion = validarSeleccion(pagables, ids);
  if (!validacion.ok) return jsonResponse(400, { error: 'seleccion_invalida', mensaje: validacion.error });

  let provider;
  try {
    provider = construirPaymentProvider('MERCADOPAGO', env);
  } catch {
    return jsonResponse(503, { error: 'pasarela_no_configurada', mensaje: 'El pago en línea no está disponible en este momento.' });
  }

  const commerceOrder = generarCommerceOrder();
  const { data: pago, error: errPago } = await supabase.rpc('fn_crear_pago_cuenta', {
    p_apoderado_id: apoderadoId,
    p_cargo_ids: ids,
    p_medio: 'MERCADOPAGO',
    p_commerce_order: commerceOrder,
  });
  if (errPago || !pago) {
    const mensaje = errPago?.message.includes('vencida_mas_antigua')
      ? 'Debes incluir la mensualidad vencida más antigua.'
      : 'No pudimos preparar el pago. Recarga la página e inténtalo nuevamente.';
    return jsonResponse(409, { error: 'no_se_pudo_crear_el_pago', mensaje });
  }

  const siteUrl = env.SITE_URL ?? 'https://firehousecheer.cl';
  const urlResultado = `${siteUrl}/pagar/resultado?pago=${encodeURIComponent(commerceOrder)}`;
  const elegidos = pagables.filter((c) => ids.includes(c.id));
  const nombreAtleta = (id: string | null) => cuenta.atletas.find((a) => a.id === id)?.nombre;

  try {
    const preferencia = await provider.crearPreferencia({
      commerceOrder,
      items: elegidos.map((c) => ({
        producto: c.concepto_codigo,
        nombre: nombreAtleta(c.atleta_id) ? `${c.descripcion} · ${nombreAtleta(c.atleta_id)}` : c.descripcion,
        precio: c.saldo,
      })),
      email: cuenta.apoderado?.email ?? '',
      urlWebhook: `${siteUrl}/api/mercadopago/webhook`,
      // La página de resultado nunca confía en la URL de retorno: vuelve a
      // consultar el estado real del pago.
      urlExito: urlResultado,
      urlPendiente: urlResultado,
      urlError: urlResultado,
    });
    await supabase.from('pagos').update({ referencia_externa: preferencia.referenciaExterna }).eq('commerce_order', commerceOrder);
    return jsonResponse(200, { url: preferencia.urlPago, pago: commerceOrder });
  } catch {
    await supabase.from('pagos').update({ estado: 'ANULADO' }).eq('commerce_order', commerceOrder);
    return jsonResponse(502, { error: 'pasarela_error', mensaje: 'No pudimos conectar con Mercado Pago. Inténtalo en unos minutos.' });
  }
};
