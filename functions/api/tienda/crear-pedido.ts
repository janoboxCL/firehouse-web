// POST /api/tienda/crear-pedido  { apoderado, alumno, email, items: [{ talla, cantidad }] }
// Crea el pedido de poleras y devuelve la URL de pago de Mercado Pago.
// El precio y el total salen de la base, nunca del navegador.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { construirPaymentProvider, type PaymentProvidersEnv } from '../../lib/payment-providers/index.ts';
import { generarCommerceOrderTienda, PRODUCTO_POLERA, validarPedido } from '../../../src/lib/crm/tienda.ts';

interface Env extends PaymentProvidersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE_URL?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  // Campo trampa: las personas no lo ven; si viene con algo, es un robot.
  if (typeof cuerpo.sitio === 'string' && cuerpo.sitio.trim() !== '') return jsonResponse(400, { error: 'solicitud_invalida' });

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: producto } = await supabase
    .from('tienda_productos')
    .select('codigo, nombre, precio, tallas, activo')
    .eq('codigo', PRODUCTO_POLERA)
    .maybeSingle();
  if (!producto || !producto.activo || !(producto.precio > 0)) {
    return jsonResponse(403, { error: 'tienda_cerrada', mensaje: 'La venta de poleras no está disponible en este momento.' });
  }

  const validacion = validarPedido(cuerpo, { precio: producto.precio as number, tallas: producto.tallas as string[] });
  if (!validacion.ok) return jsonResponse(400, { error: 'datos_invalidos', errores: validacion.errores });
  const { apoderado, alumno, email, items, total } = validacion.datos;

  let provider;
  try {
    provider = construirPaymentProvider('MERCADOPAGO', env);
  } catch {
    return jsonResponse(503, { error: 'pasarela_no_configurada', mensaje: 'El pago en línea no está disponible en este momento.' });
  }

  const commerceOrder = generarCommerceOrderTienda();
  const { data: pedido, error: errPedido } = await supabase
    .from('tienda_pedidos')
    .insert({ commerce_order: commerceOrder, apoderado_nombre: apoderado, alumno_nombre: alumno, email, monto_total: total })
    .select('id')
    .single();
  if (errPedido || !pedido) {
    return jsonResponse(500, { error: 'no_se_pudo_crear_el_pedido', mensaje: 'No pudimos preparar el pedido. Inténtalo nuevamente.' });
  }
  const { error: errItems } = await supabase.from('tienda_pedido_items').insert(
    items.map((i) => ({ pedido_id: pedido.id, producto_codigo: PRODUCTO_POLERA, talla: i.talla, cantidad: i.cantidad, precio_unitario: producto.precio })),
  );
  if (errItems) {
    await supabase.from('tienda_pedidos').delete().eq('id', pedido.id);
    return jsonResponse(500, { error: 'no_se_pudo_crear_el_pedido', mensaje: 'No pudimos preparar el pedido. Inténtalo nuevamente.' });
  }

  const siteUrl = env.SITE_URL ?? 'https://firehousecheer.cl';
  const urlResultado = `${siteUrl}/poleras/gracias?pedido=${encodeURIComponent(commerceOrder)}`;
  try {
    const preferencia = await provider.crearPreferencia({
      commerceOrder,
      // Una línea por talla, con el subtotal de esa talla.
      items: items.map((i) => ({
        producto: PRODUCTO_POLERA,
        nombre: `${producto.nombre} · talla ${i.talla}${i.cantidad > 1 ? ` (x${i.cantidad})` : ''}`,
        precio: i.cantidad * (producto.precio as number),
      })),
      email,
      urlWebhook: `${siteUrl}/api/mercadopago/webhook`,
      // La página de resultado nunca confía en la URL de retorno: consulta el estado real.
      urlExito: urlResultado,
      urlPendiente: urlResultado,
      urlError: urlResultado,
    });
    await supabase.from('tienda_pedidos').update({ referencia_externa: preferencia.referenciaExterna }).eq('id', pedido.id);
    return jsonResponse(200, { url: preferencia.urlPago, pedido: commerceOrder });
  } catch {
    await supabase.from('tienda_pedidos').update({ estado: 'ANULADO' }).eq('id', pedido.id);
    return jsonResponse(502, { error: 'pasarela_error', mensaje: 'No pudimos conectar con Mercado Pago. Inténtalo en unos minutos.' });
  }
};
