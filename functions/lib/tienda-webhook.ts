// Procesa en el webhook de Mercado Pago los pedidos de la tienda de poleras
// (commerce_order "TIENDA-..."). El pago ya viene consultado directo a la API.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstadoPagoConsultado } from './payment-providers/types.ts';
import { enviarComprobanteTienda, resolverBcc } from './resend.ts';

export interface EnvTienda {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_STAR?: string;
  EMAIL_BCC?: string;
}

export async function procesarPedidoTienda(supabase: SupabaseClient, env: EnvTienda, estado: EstadoPagoConsultado): Promise<Response> {
  const { data: pedido, error } = await supabase
    .from('tienda_pedidos')
    .select('id, estado, monto_total')
    .eq('commerce_order', estado.commerceOrder)
    .maybeSingle();
  if (error) return new Response('no se pudo leer el pedido', { status: 500 });
  // Un pedido que no existe no se arregla reintentando.
  if (!pedido) {
    console.error('tienda_pedido_no_existe', estado.commerceOrder);
    return new Response('ok (pedido no existe)', { status: 200 });
  }

  if (estado.estado === 'APROBADO') {
    if (estado.monto !== pedido.monto_total || estado.moneda !== 'CLP') {
      console.error('tienda_monto_o_moneda_no_calza', JSON.stringify({ co: estado.commerceOrder, pagado: estado.monto, esperado: pedido.monto_total, moneda: estado.moneda }));
      return new Response('ok (revisar)', { status: 200 });
    }
    // Idempotente: solo pasa a PAGADO si aún no lo estaba.
    const { error: errPagar } = await supabase
      .from('tienda_pedidos')
      .update({
        estado: 'PAGADO',
        pagado_at: new Date().toISOString(),
        pasarela_payment_id: estado.pasarelaPaymentId,
        metodo_pago: estado.metodoPago,
        datos_json: estado.datosCrudos,
      })
      .eq('id', pedido.id)
      .neq('estado', 'PAGADO');
    if (errPagar) {
      console.error('tienda_confirmar_error', errPagar.message);
      return new Response('no se pudo confirmar el pago', { status: 500 });
    }
    try {
      await enviarComprobanteTiendaSiCorresponde(supabase, env, pedido.id as string);
    } catch (err) {
      console.error('comprobante_tienda_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
    }
  } else if (estado.estado === 'REEMBOLSADO') {
    await supabase.from('tienda_pedidos').update({ estado: 'REEMBOLSADO' }).eq('id', pedido.id);
  } else if (estado.estado === 'RECHAZADO') {
    // Un rechazo nunca pisa un pedido ya pagado (puede haber un segundo intento aprobado).
    await supabase.from('tienda_pedidos').update({ estado: 'RECHAZADO' }).eq('id', pedido.id).eq('estado', 'PENDIENTE');
  }
  return new Response('ok', { status: 200 });
}

/** Envía el comprobante una sola vez por pedido. */
export async function enviarComprobanteTiendaSiCorresponde(supabase: SupabaseClient, env: EnvTienda, pedidoId: string): Promise<boolean> {
  const remitente = env.EMAIL_FROM_STAR ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !remitente) return false;

  // Reserva el envío: si dos avisos llegan a la vez, solo uno lo toma.
  const { data: pedido } = await supabase
    .from('tienda_pedidos')
    .update({ comprobante_enviado_at: new Date().toISOString() })
    .eq('id', pedidoId)
    .eq('estado', 'PAGADO')
    .is('comprobante_enviado_at', null)
    .select('id, commerce_order, apoderado_nombre, alumno_nombre, email, monto_total, pagado_at, pasarela_payment_id, tienda_pedido_items ( talla, cantidad, precio_unitario, tienda_productos ( nombre ) )')
    .maybeSingle();
  if (!pedido) return false;

  try {
    const items = (pedido.tienda_pedido_items ?? []) as unknown as Array<{ talla: string; cantidad: number; precio_unitario: number; tienda_productos: { nombre: string } | null }>;
    await enviarComprobanteTienda(
      env.RESEND_API_KEY,
      remitente,
      {
        nombre: (pedido.apoderado_nombre as string).split(' ')[0],
        alumno: pedido.alumno_nombre as string,
        email: pedido.email as string,
        numero: pedido.commerce_order as string,
        fecha: (pedido.pagado_at as string) ?? new Date().toISOString(),
        idPasarela: (pedido.pasarela_payment_id as string | null) ?? null,
        lineas: items.map((i) => ({
          descripcion: `${i.tienda_productos?.nombre ?? 'Polera Firehouse'} · talla ${i.talla} × ${i.cantidad}`,
          monto: i.cantidad * i.precio_unitario,
        })),
        total: pedido.monto_total as number,
      },
      resolverBcc(env.EMAIL_BCC),
    );
    return true;
  } catch (err) {
    // Libera la reserva para poder reintentar.
    await supabase.from('tienda_pedidos').update({ comprobante_enviado_at: null }).eq('id', pedidoId);
    throw err;
  }
}
