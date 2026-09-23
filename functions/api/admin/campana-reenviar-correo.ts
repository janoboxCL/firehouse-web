// Cloudflare Pages Function — POST /api/admin/campana-reenviar-correo
//
// Reenvía un correo de la Campaña 2026 (confirmación de compra o participación
// sin compra) a partir de su fila en campana_email_outbox. Solo administradores.
//
// Nunca genera participaciones: usa los códigos guardados en el outbox cuando
// se confirmó el pago o la participación. Actualiza intentos, estado y error.

import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import { enviarCorreoConfirmacionCampana, enviarCorreoParticipacionGratisCampana } from '../../lib/resend.ts';

interface Env extends AdminEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
  SITE_URL?: string;
}

interface Payload {
  codigos?: string[];
  total?: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const { supabase } = admin;

  const remitente = env.EMAIL_FROM_CAMPANA ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !remitente) return jsonResponse(503, { error: 'correo_no_configurado' });

  let outboxId = '';
  try {
    outboxId = String(((await request.json()) as Record<string, unknown>).outboxId ?? '');
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  if (!/^[0-9a-f-]{36}$/i.test(outboxId)) return jsonResponse(400, { error: 'outbox_invalido' });

  const { data: fila } = await supabase
    .from('campana_email_outbox')
    .select('id, tipo, order_id, participant_id, destinatario, payload, status, attempts')
    .eq('id', outboxId)
    .maybeSingle();
  if (!fila) return jsonResponse(404, { error: 'correo_no_encontrado' });

  // Reserva la fila para que dos clics simultáneos no envíen dos correos.
  const { data: reservada } = await supabase
    .from('campana_email_outbox')
    .update({ status: 'SENDING', updated_at: new Date().toISOString() })
    .eq('id', fila.id)
    .neq('status', 'SENDING')
    .select('id')
    .maybeSingle();
  if (!reservada) return jsonResponse(409, { error: 'envio_en_curso' });

  const payload = (fila.payload ?? {}) as Payload;
  const codigos = Array.isArray(payload.codigos) ? payload.codigos : [];
  const intentos = (fila.attempts ?? 0) + 1;

  try {
    if (fila.tipo === 'CONFIRMACION_COMPRA') {
      const { data: orden } = await supabase
        .from('campana_ordenes')
        .select('id, comprador_nombre, comprador_email, monto, commerce_order, estado, campana_orden_items ( producto )')
        .eq('id', fila.order_id)
        .single();
      if (!orden || orden.estado !== 'PAGADA') throw new Error('La orden no está pagada.');
      const productos = ((orden as unknown as { campana_orden_items: { producto: string }[] }).campana_orden_items ?? []).map(
        (i) => i.producto,
      );
      await enviarCorreoConfirmacionCampana(env.RESEND_API_KEY, remitente, {
        compradorNombre: orden.comprador_nombre,
        compradorEmail: orden.comprador_email,
        monto: orden.monto,
        commerceOrder: orden.commerce_order,
        ordenId: orden.id,
        productos,
        codigos,
        totalParticipaciones: payload.total ?? codigos.length,
        siteUrl: env.SITE_URL ?? 'https://firehousecheer.cl',
      });
    } else {
      const { data: participante } = await supabase
        .from('campana_participantes')
        .select('nombre, email')
        .eq('id', fila.participant_id)
        .single();
      if (!participante) throw new Error('Participante no encontrado.');
      await enviarCorreoParticipacionGratisCampana(env.RESEND_API_KEY, remitente, {
        nombre: participante.nombre,
        email: participante.email,
        codigos,
        total: payload.total ?? codigos.length,
      });
    }

    await supabase
      .from('campana_email_outbox')
      .update({ status: 'SENT', sent_at: new Date().toISOString(), attempts: intentos, last_error: null, updated_at: new Date().toISOString() })
      .eq('id', fila.id);
    return jsonResponse(200, { ok: true });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message.slice(0, 500) : 'desconocido';
    await supabase
      .from('campana_email_outbox')
      .update({ status: 'FAILED', attempts: intentos, last_error: mensaje, updated_at: new Date().toISOString() })
      .eq('id', fila.id);
    return jsonResponse(502, { error: 'no_se_pudo_enviar', detalle: mensaje });
  }
};
