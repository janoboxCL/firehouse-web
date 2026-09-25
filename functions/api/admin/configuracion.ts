// /api/admin/configuracion — cargos de usuarios del CRM y pasarelas de pago.
// Lectura: cualquier administrador activo. Cambios: solo rol ADMIN.

import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

interface Env extends AdminEnv {
  FLOW_API_KEY?: string;
  FLOW_SECRET_KEY?: string;
  FLOW_BASE_URL?: string;
  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_WEBHOOK_SECRET?: string;
}

const CARGOS = ['Head Coach', 'Coach', 'Asistente'];
const PASARELAS = ['FLOW', 'MERCADOPAGO', 'GETNET'] as const;

function pasarelaConfigurada(id: string, env: Env): boolean {
  if (id === 'MERCADOPAGO') return !!(env.MERCADOPAGO_ACCESS_TOKEN && env.MERCADOPAGO_WEBHOOK_SECRET);
  if (id === 'FLOW') return !!(env.FLOW_API_KEY && env.FLOW_SECRET_KEY && env.FLOW_BASE_URL);
  return false; // GETNET: no implementada
}

async function estado(supabase: SupabaseClient, env: Env, userId: string) {
  const [{ data: usuarios }, { data: pasarelas }, { data: yo }] = await Promise.all([
    supabase.from('admin_profiles').select('user_id, display_name, nombre_firma, cargo, role, active').order('display_name'),
    supabase.from('campana_pasarelas').select('id, habilitada, preferida').order('id'),
    supabase.from('admin_profiles').select('role').eq('user_id', userId).maybeSingle(),
  ]);
  return {
    esAdmin: yo?.role === 'ADMIN',
    usuarios: usuarios ?? [],
    pasarelas: (pasarelas ?? []).map((p) => ({ ...p, configurada: pasarelaConfigurada(p.id as string, env) })),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  return jsonResponse(200, await estado(admin.supabase, env, admin.userId));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const { supabase, userId } = admin;

  const { data: yo } = await supabase.from('admin_profiles').select('role').eq('user_id', userId).maybeSingle();
  if (yo?.role !== 'ADMIN') return jsonResponse(403, { error: 'solo_admin', mensaje: 'Solo un usuario con rol ADMIN puede cambiar esto.' });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }

  if (b.accion === 'cargo') {
    const destino = String(b.userId ?? '');
    const cargo = String(b.cargo ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(destino) || !CARGOS.includes(cargo)) return jsonResponse(400, { error: 'datos_invalidos' });
    // Con la clave de servicio no hay sesión de usuario, así que el trigger que
    // protege el cargo (0009) permite el cambio.
    const { error } = await supabase.from('admin_profiles').update({ cargo }).eq('user_id', destino);
    if (error) return jsonResponse(500, { error: 'no_se_pudo_guardar' });
    return jsonResponse(200, await estado(supabase, env, userId));
  }

  if (b.accion === 'pasarela') {
    const id = String(b.id ?? '') as (typeof PASARELAS)[number];
    const cambio = String(b.cambio ?? '');
    if (!PASARELAS.includes(id) || !['habilitar', 'deshabilitar', 'preferir'].includes(cambio)) {
      return jsonResponse(400, { error: 'datos_invalidos' });
    }
    const { data: actuales } = await supabase.from('campana_pasarelas').select('id, habilitada, preferida');
    const lista = actuales ?? [];

    if (cambio !== 'deshabilitar' && !pasarelaConfigurada(id, env)) {
      return jsonResponse(409, {
        error: 'no_configurada',
        mensaje: id === 'GETNET' ? 'Getnet aún no está implementada.' : `Faltan las credenciales de ${id === 'FLOW' ? 'Flow' : 'Mercado Pago'} en Cloudflare.`,
      });
    }
    if (cambio === 'deshabilitar' && !lista.some((p) => p.id !== id && p.habilitada)) {
      return jsonResponse(409, {
        error: 'ultima_pasarela',
        mensaje: 'Debe quedar al menos una pasarela habilitada: sin ella no se puede pagar el registro Star ni la campaña.',
      });
    }

    if (cambio === 'habilitar') {
      await supabase.from('campana_pasarelas').update({ habilitada: true }).eq('id', id);
    } else if (cambio === 'deshabilitar') {
      await supabase.from('campana_pasarelas').update({ habilitada: false, preferida: false }).eq('id', id);
      // Si era la preferida, pasa a serlo otra habilitada.
      if (lista.find((p) => p.id === id)?.preferida) {
        const otra = lista.find((p) => p.id !== id && p.habilitada);
        if (otra) await supabase.from('campana_pasarelas').update({ preferida: true }).eq('id', otra.id);
      }
    } else {
      await supabase.from('campana_pasarelas').update({ preferida: false }).neq('id', id);
      const { error } = await supabase.from('campana_pasarelas').update({ habilitada: true, preferida: true }).eq('id', id);
      if (error) return jsonResponse(500, { error: 'no_se_pudo_guardar' });
    }
    return jsonResponse(200, await estado(supabase, env, userId));
  }

  return jsonResponse(400, { error: 'accion_invalida' });
};
