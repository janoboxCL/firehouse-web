// /api/admin/cuenta — cuenta corriente de una familia desde el panel.
//
// GET  ?apoderadoId=…  → link, cargos con saldo y pagos
// POST { accion: 'generar_link', atletaId? , apoderadoId? }
//        Crea (si faltan) los cargos Star del deportista y devuelve el link familiar.
//      { accion: 'pago_manual', apoderadoId, cargoIds, medio, referencia }
//      { accion: 'anular_cargo', cargoId, motivo }      (solo sin pagos aplicados)
//      { accion: 'revocar_link', apoderadoId }          (el próximo link será otro)
// Solo administradores activos.

import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import { asegurarCargosStar, estadoCuenta, obtenerOCrearToken } from '../../lib/cuenta-servidor.ts';
import { enviarComprobanteSiCorresponde, type EnvCorreo } from '../../lib/cuenta-comprobante.ts';
import { urlCuenta } from '../../../src/lib/crm/cuenta.ts';

interface Env extends AdminEnv, EnvCorreo {}

const UUID = /^[0-9a-f-]{36}$/i;

async function respuestaEstado(supabase: Parameters<typeof estadoCuenta>[0], env: Env, apoderadoId: string) {
  const [cuenta, link] = await Promise.all([
    estadoCuenta(supabase, apoderadoId),
    supabase.from('links_pago').select('token, revocado_at').eq('apoderado_id', apoderadoId).maybeSingle(),
  ]);
  const token = link.data && !link.data.revocado_at ? (link.data.token as string) : null;
  return {
    link: token ? urlCuenta(env.SITE_URL ?? 'https://firehousecheer.cl', token) : null,
    atletas: cuenta.atletas,
    cargos: cuenta.cargos,
    pagos: cuenta.pagos,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const apoderadoId = new URL(request.url).searchParams.get('apoderadoId') ?? '';
  if (!UUID.test(apoderadoId)) return jsonResponse(400, { error: 'apoderado_invalido' });
  try {
    return jsonResponse(200, await respuestaEstado(admin.supabase, env, apoderadoId));
  } catch {
    return jsonResponse(500, { error: 'no_disponible', mensaje: 'No se pudo leer la cuenta. ¿Está aplicada la migración 0011?' });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const { supabase, userId } = admin;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  const accion = String(b.accion ?? '');

  if (accion === 'generar_link') {
    let apoderadoId = String(b.apoderadoId ?? '');
    const atletaId = String(b.atletaId ?? '');
    let creados: string[] = [];
    let aviso: string | null = null;
    if (UUID.test(atletaId)) {
      const { data: atleta } = await supabase.from('atletas').select('apoderado_id').eq('id', atletaId).maybeSingle();
      if (!atleta) return jsonResponse(404, { error: 'atleta_no_encontrado' });
      apoderadoId = atleta.apoderado_id as string;
      try {
        creados = (await asegurarCargosStar(supabase, atletaId, userId)).creados;
      } catch (e) {
        const m = e instanceof Error ? e.message : '';
        if (m === 'sin_precios_star') return jsonResponse(409, { error: m, mensaje: 'Faltan los precios de Firehouse Star para esta temporada (Configuración).' });
        if (m !== 'sin_caso_star') return jsonResponse(500, { error: 'no_se_pudieron_crear_cargos' });
        aviso = 'Este deportista no tiene un caso Star: el link muestra solo sus cargos existentes.';
      }
    }
    if (!UUID.test(apoderadoId)) return jsonResponse(400, { error: 'apoderado_invalido' });
    const token = await obtenerOCrearToken(supabase, apoderadoId);
    return jsonResponse(200, { url: urlCuenta(env.SITE_URL ?? 'https://firehousecheer.cl', token), creados, aviso });
  }

  if (accion === 'pago_manual') {
    const apoderadoId = String(b.apoderadoId ?? '');
    const cargoIds = Array.isArray(b.cargoIds) ? b.cargoIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
    const medio = String(b.medio ?? '');
    const referencia = String(b.referencia ?? '').trim().slice(0, 200) || null;
    if (!UUID.test(apoderadoId) || cargoIds.length === 0 || !['EFECTIVO', 'TRANSFERENCIA'].includes(medio)) {
      return jsonResponse(400, { error: 'datos_invalidos', mensaje: 'Selecciona al menos un cargo y el medio de pago.' });
    }
    const { data, error } = await supabase.rpc('fn_registrar_pago_manual', {
      p_apoderado_id: apoderadoId, p_cargo_ids: cargoIds, p_medio: medio, p_referencia: referencia, p_registrado_por: userId,
    });
    if (error) {
      const mensaje = error.message.includes('vencida_mas_antigua')
        ? 'Debes incluir la mensualidad vencida más antigua.'
        : error.message.includes('cargos_invalidos')
          ? 'Algún cargo ya está pagado o anulado. Recarga la ficha.'
          : 'No se pudo registrar el pago.';
      return jsonResponse(409, { error: 'rechazado', mensaje });
    }
    let comprobante = false;
    try {
      comprobante = await enviarComprobanteSiCorresponde(supabase, env, (data as { pago_id: string }).pago_id);
    } catch {
      comprobante = false;
    }
    return jsonResponse(200, { ...(await respuestaEstado(supabase, env, apoderadoId)), comprobante });
  }

  if (accion === 'anular_cargo') {
    const cargoId = String(b.cargoId ?? '');
    const motivo = String(b.motivo ?? '').trim().slice(0, 200);
    if (!UUID.test(cargoId) || motivo.length < 3) return jsonResponse(400, { error: 'datos_invalidos', mensaje: 'Indica el motivo de la anulación.' });
    const { data: cargo } = await supabase.from('v_cargos_saldo').select('apoderado_id, estado, pagado').eq('id', cargoId).maybeSingle();
    if (!cargo) return jsonResponse(404, { error: 'cargo_no_encontrado' });
    if (cargo.estado !== 'PENDIENTE' || (cargo.pagado as number) > 0) {
      return jsonResponse(409, { error: 'rechazado', mensaje: 'Solo se pueden anular cargos sin pagos aplicados.' });
    }
    const { error } = await supabase.from('cargos')
      .update({ estado: 'ANULADO', anulado_motivo: motivo, anulado_at: new Date().toISOString() }).eq('id', cargoId);
    if (error) return jsonResponse(500, { error: 'no_se_pudo_anular' });
    return jsonResponse(200, await respuestaEstado(supabase, env, cargo.apoderado_id as string));
  }

  if (accion === 'revocar_link') {
    const apoderadoId = String(b.apoderadoId ?? '');
    if (!UUID.test(apoderadoId)) return jsonResponse(400, { error: 'apoderado_invalido' });
    await supabase.from('links_pago').update({ revocado_at: new Date().toISOString() }).eq('apoderado_id', apoderadoId);
    return jsonResponse(200, await respuestaEstado(supabase, env, apoderadoId));
  }

  return jsonResponse(400, { error: 'accion_invalida' });
};
