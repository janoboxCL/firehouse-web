// Cloudflare Pages Function — /api/admin/campana-estado
//
// GET:  estado de la Campaña 2026 (habilitación, periodo y lista de chequeos).
// POST: { accion } para habilitar o deshabilitar compras y participación sin
//       compra, completar la configuración con los valores de las bases,
//       adelantar el inicio para pruebas o restablecerlo, e invalidar las
//       participaciones de prueba. Solo administradores activos.
//
// La base de datos rechaza por sí sola la habilitación si falta configuración
// (trigger campana_config_validar_activacion). Aquí se agrega lo que solo
// conoce el servidor: el secreto de identidad y la configuración de correo.

import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import {
  BASES_OFICIALES,
  chequeosCampana,
  estadoCampana,
  inicioAdelantado,
  mensajeErrorActivacion,
  type ConfigCampana,
  type EntornoCampana,
} from '../../../src/lib/crm/campana-estado.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

interface Env extends AdminEnv {
  CAMPAIGN_IDENTITY_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_CAMPANA?: string;
}

const COLUMNAS =
  'checkout_habilitado, participacion_habilitada, bases_version, privacy_version, inicio_at, cierre_at, sorteo_at, premios, proveedor_pago, email_configurado, schema_version';

const ACCIONES = [
  'habilitar_compras', 'deshabilitar_compras', 'habilitar_gratis', 'deshabilitar_gratis',
  'aplicar_config_bases', 'inicio_ahora', 'inicio_oficial', 'invalidar_pruebas',
] as const;
type Accion = (typeof ACCIONES)[number];

async function leerEstado(supabase: SupabaseClient, env: Env) {
  const { data: config, error } = await supabase.from('campana_config').select(COLUMNAS).eq('id', 1).single();
  if (error || !config) throw new Error('config_no_disponible');

  const [pasarelas, anteriores, snapshot] = await Promise.all([
    supabase.from('campana_pasarelas').select('id').eq('habilitada', true),
    supabase.from('campana_entradas').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').is('participant_id', null),
    supabase.from('campana_draw_snapshot').select('id', { count: 'exact', head: true }),
  ]);
  const { count: pruebas } = await supabase
    .from('campana_entradas')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ACTIVE')
    .lt('created_at', BASES_OFICIALES.inicio);

  const entorno: EntornoCampana = {
    secretoIdentidad: !!env.CAMPAIGN_IDENTITY_SECRET,
    correoServidor: !!env.RESEND_API_KEY && !!(env.EMAIL_FROM_CAMPANA || env.EMAIL_FROM),
    pasarelaHabilitada: (pasarelas.data ?? []).length > 0,
    participacionesAnterioresActivas: anteriores.count ?? 0,
    sorteoCerrado: (snapshot.count ?? 0) > 0,
  };
  const c = config as unknown as ConfigCampana;
  return {
    config: c,
    estado: estadoCampana(c, entorno, Date.now()),
    chequeos: chequeosCampana(c, entorno),
    inicioAdelantado: inicioAdelantado(c),
    participacionesPrueba: pruebas ?? 0,
    oficiales: BASES_OFICIALES,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  try {
    return jsonResponse(200, await leerEstado(admin.supabase, env));
  } catch {
    return jsonResponse(500, { error: 'config_no_disponible', mensaje: 'No se pudo leer la configuración. ¿Está aplicada la migración 0005?' });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const { supabase } = admin;

  let accion: Accion;
  try {
    accion = String(((await request.json()) as Record<string, unknown>).accion ?? '') as Accion;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  if (!ACCIONES.includes(accion)) return jsonResponse(400, { error: 'accion_invalida' });

  const habilita = accion === 'habilitar_compras' || accion === 'habilitar_gratis';
  if (habilita && !env.CAMPAIGN_IDENTITY_SECRET) {
    return jsonResponse(409, { error: 'secreto_faltante', mensaje: 'Falta CAMPAIGN_IDENTITY_SECRET en Cloudflare. Créalo y vuelve a desplegar.' });
  }
  if (habilita && !(env.RESEND_API_KEY && (env.EMAIL_FROM_CAMPANA || env.EMAIL_FROM))) {
    return jsonResponse(409, { error: 'correo_faltante', mensaje: 'Falta la configuración de correo (RESEND_API_KEY y EMAIL_FROM) en Cloudflare.' });
  }

  let error: { message: string } | null = null;
  if (accion === 'invalidar_pruebas') {
    // Solo participaciones creadas antes del inicio oficial: anteriores a la
    // mecánica unificada o de pruebas. Quedan en el historial, no se borran.
    ({ error } = await supabase
      .from('campana_entradas')
      .update({ status: 'INVALIDATED', invalidated_at: new Date().toISOString(), invalidated_reason: 'PRUEBA_PREVIA_A_LANZAMIENTO' })
      .eq('status', 'ACTIVE')
      .lt('created_at', BASES_OFICIALES.inicio));
  } else {
    let cambios: Record<string, unknown> = {};
    if (accion === 'habilitar_compras') cambios = { checkout_habilitado: true };
    if (accion === 'deshabilitar_compras') cambios = { checkout_habilitado: false };
    if (accion === 'habilitar_gratis') cambios = { participacion_habilitada: true };
    if (accion === 'deshabilitar_gratis') cambios = { participacion_habilitada: false };
    if (accion === 'aplicar_config_bases') {
      const { data: actual } = await supabase.from('campana_config').select('inicio_at').eq('id', 1).single();
      cambios = {
        bases_version: BASES_OFICIALES.basesVersion,
        privacy_version: BASES_OFICIALES.privacyVersion,
        // Si el inicio está adelantado para pruebas, se respeta.
        inicio_at: actual?.inicio_at && inicioAdelantado({ inicio_at: actual.inicio_at }) ? actual.inicio_at : BASES_OFICIALES.inicio,
        cierre_at: BASES_OFICIALES.cierre,
        sorteo_at: BASES_OFICIALES.sorteo,
        premios: BASES_OFICIALES.premios,
        proveedor_pago: BASES_OFICIALES.proveedorPago,
        email_configurado: !!(env.RESEND_API_KEY && (env.EMAIL_FROM_CAMPANA || env.EMAIL_FROM)),
      };
    }
    if (accion === 'inicio_ahora') cambios = { inicio_at: new Date(Date.now() - 60_000).toISOString() };
    if (accion === 'inicio_oficial') cambios = { inicio_at: BASES_OFICIALES.inicio };
    ({ error } = await supabase.from('campana_config').update(cambios).eq('id', 1));
  }

  if (error) return jsonResponse(409, { error: 'rechazado', mensaje: mensajeErrorActivacion(error.message) });
  try {
    return jsonResponse(200, await leerEstado(supabase, env));
  } catch {
    return jsonResponse(500, { error: 'config_no_disponible' });
  }
};
