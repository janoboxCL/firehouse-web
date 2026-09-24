// Comprobante de pago de la cuenta corriente: se envía una sola vez por pago.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarComprobantePagoCuenta } from './resend.ts';
import { obtenerOCrearToken, primerNombre } from './cuenta-servidor.ts';
import { urlCuenta } from '../../src/lib/crm/cuenta.ts';

export interface EnvCorreo {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_STAR?: string;
  SITE_URL?: string;
}

export async function enviarComprobanteSiCorresponde(supabase: SupabaseClient, env: EnvCorreo, pagoId: string): Promise<boolean> {
  const remitente = env.EMAIL_FROM_STAR ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !remitente) return false;

  // Reserva el envío: si dos procesos llegan a la vez, solo uno lo toma.
  const { data: pago } = await supabase
    .from('pagos')
    .update({ comprobante_enviado_at: new Date().toISOString() })
    .eq('id', pagoId)
    .eq('estado', 'APROBADO')
    .is('comprobante_enviado_at', null)
    .select('id, apoderado_id, commerce_order, medio, monto_total, pasarela_payment_id, aprobado_at')
    .maybeSingle();
  if (!pago) return false;

  try {
    const [{ data: apoderado }, { data: detalle }] = await Promise.all([
      supabase.from('apoderados').select('nombre, email').eq('id', pago.apoderado_id).single(),
      supabase.from('pago_detalle').select('monto, cargos ( descripcion, atletas ( nombre ) )').eq('pago_id', pago.id),
    ]);
    if (!apoderado) throw new Error('apoderado_no_encontrado');
    const token = await obtenerOCrearToken(supabase, pago.apoderado_id as string);
    const lineas = (detalle ?? []).map((d) => {
      const cargo = (d as unknown as { cargos: { descripcion: string; atletas: { nombre: string } | null } }).cargos;
      return { deportista: cargo?.atletas ? primerNombre(cargo.atletas.nombre) : null, descripcion: cargo?.descripcion ?? '', monto: d.monto as number };
    });
    await enviarComprobantePagoCuenta(env.RESEND_API_KEY, remitente, {
      nombre: primerNombre(apoderado.nombre as string),
      email: apoderado.email as string,
      numero: pago.commerce_order as string,
      fecha: (pago.aprobado_at as string) ?? new Date().toISOString(),
      medio: pago.medio as string,
      idPasarela: (pago.pasarela_payment_id as string | null) ?? null,
      lineas,
      total: pago.monto_total as number,
      urlCuenta: urlCuenta(env.SITE_URL ?? 'https://firehousecheer.cl', token),
    });
    return true;
  } catch (err) {
    // Libera la reserva para poder reintentar.
    await supabase.from('pagos').update({ comprobante_enviado_at: null }).eq('id', pago.id);
    throw err;
  }
}
