// Procesa en el webhook de Mercado Pago los pagos de la cuenta corriente
// (commerce_order "PAGO-..."). El pago ya viene consultado directo a la API.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstadoPagoConsultado } from './payment-providers/types.ts';
import { enviarComprobanteSiCorresponde, type EnvCorreo } from './cuenta-comprobante.ts';

export function esPagoCuenta(commerceOrder: string): boolean {
  return commerceOrder.startsWith('PAGO-');
}

export async function procesarPagoCuenta(supabase: SupabaseClient, env: EnvCorreo, estado: EstadoPagoConsultado): Promise<Response> {
  if (estado.estado === 'APROBADO') {
    const { data, error } = await supabase.rpc('fn_confirmar_pago_cuenta', {
      p_commerce_order: estado.commerceOrder,
      p_pasarela_payment_id: estado.pasarelaPaymentId,
      p_monto: estado.monto,
      p_moneda: estado.moneda,
      p_metodo_pago: estado.metodoPago,
      p_datos_json: estado.datosCrudos,
    });
    if (error) {
      console.error('fn_confirmar_pago_cuenta_error', error.message);
      // Reintentar no corrige un monto distinto ni un pago duplicado: se registra y se responde 200.
      if (/monto_o_moneda|payment_id_d|pago_no_existe/.test(error.message)) return new Response('ok (revisar)', { status: 200 });
      return new Response('no se pudo confirmar el pago', { status: 500 });
    }
    try {
      await enviarComprobanteSiCorresponde(supabase, env, (data as { pago_id: string }).pago_id);
    } catch (err) {
      console.error('comprobante_pago_cuenta_error', err instanceof Error ? err.message.slice(0, 200) : 'desconocido');
    }
  } else if (estado.estado === 'REEMBOLSADO') {
    await supabase.rpc('fn_marcar_pago_cuenta_reembolsado', { p_commerce_order: estado.commerceOrder });
  } else {
    await supabase.rpc('fn_marcar_pago_cuenta_no_aprobado', { p_commerce_order: estado.commerceOrder, p_estado: estado.estado });
  }
  return new Response('ok', { status: 200 });
}
