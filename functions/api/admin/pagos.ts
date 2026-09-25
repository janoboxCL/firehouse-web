// /api/admin/pagos — menú de pagos del panel (migraciones 0011 y 0013).
//
// GET  ?programa=STAR|ALL_STAR   → una fila por familia con cargos, saldo y kits
//      ?buscar=texto              → familias para agregar un cargo (máx. 10)
// POST { accion: 'cargo_manual', apoderadoId, atletaId?, programa, concepto, descripcion, monto, vencimiento? }
//      { accion: 'registrar_kit', ordenId }      kit pagado en el registro Star → cuenta
//      { accion: 'marcar_prueba', apoderadoId, valor }
// Solo administradores activos. Siempre con la clave de servicio.

import type { SupabaseClient } from '@supabase/supabase-js';
import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import { urlCuenta } from '../../../src/lib/crm/cuenta.ts';
import { hoyChile } from '../../../src/lib/crm/programas.ts';
import {
  armarFamilias,
  esProgramaPagos,
  normalizarBusqueda,
  textoBusqueda,
  totalesPagos,
  validarCargoManual,
  type ApoderadoFila,
  type AtletaFila,
  type CargoFila,
  type DetallePago,
  type KitRegistro,
  type ProgramaPagos,
} from '../../../src/lib/crm/pagos-panel.ts';

interface Env extends AdminEnv {
  SITE_URL?: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
const ESTADOS_PERDIDOS = ['NO_INTERESADO', 'NO_CONTINUA'];

function unicos(xs: Array<string | null | undefined>): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

async function resumen(supabase: SupabaseClient, env: Env, programa: ProgramaPagos) {
  const hoy = hoyChile();

  // 1. Deportistas del programa: casos inscritos (o registro Star), inscripciones activas y cargos.
  let consultaCasos = supabase
    .from('casos_crm')
    .select('atleta_id, estado, journey, programa, created_at')
    .order('created_at', { ascending: false });
  consultaCasos =
    programa === 'STAR'
      ? consultaCasos.or('journey.eq.FIREHOUSE_STAR,and(programa.eq.STAR,estado.eq.INSCRITO)')
      : consultaCasos.eq('programa', 'ALL_STAR').eq('estado', 'INSCRITO');

  const [casosR, inscR, cargosR] = await Promise.all([
    consultaCasos,
    supabase.from('inscripciones').select('atleta_id').eq('programa_codigo', programa).eq('estado', 'ACTIVA'),
    supabase
      .from('v_cargos_saldo')
      .select('id, apoderado_id, atleta_id, concepto_codigo, descripcion, monto, saldo, vencimiento, estado')
      .eq('programa_codigo', programa)
      .neq('estado', 'ANULADO'),
  ]);
  if (casosR.error) throw casosR.error;
  if (inscR.error) throw inscR.error;
  if (cargosR.error) throw cargosR.error;

  const estadoCaso: Record<string, string> = {};
  for (const c of casosR.data ?? []) {
    if (!(c.atleta_id in estadoCaso)) estadoCaso[c.atleta_id as string] = c.estado as string;
  }
  const cargos = (cargosR.data ?? []) as CargoFila[];
  const atletaIds = unicos([
    ...(casosR.data ?? []).filter((c) => !ESTADOS_PERDIDOS.includes(c.estado as string)).map((c) => c.atleta_id as string),
    ...(inscR.data ?? []).map((i) => i.atleta_id as string),
    ...cargos.map((c) => c.atleta_id),
  ]);

  const atletasR = atletaIds.length
    ? await supabase.from('atletas').select('id, apoderado_id, nombre, apellidos').in('id', atletaIds)
    : { data: [], error: null };
  if (atletasR.error) throw atletasR.error;
  const atletas = (atletasR.data ?? []) as AtletaFila[];
  const apoderadoIds = unicos([...atletas.map((a) => a.apoderado_id), ...cargos.map((c) => c.apoderado_id)]);
  if (apoderadoIds.length === 0) {
    return { programa, hoy, familias: [], totales: totalesPagos([], [], new Set(), hoy) };
  }

  const cargoIds = cargos.map((c) => c.id);
  const [apR, linksR, pagosR, detR, kitsR] = await Promise.all([
    supabase.from('apoderados').select('id, nombre, apellidos, telefono, email, es_prueba').in('id', apoderadoIds),
    supabase.from('links_pago').select('apoderado_id, token').in('apoderado_id', apoderadoIds).is('revocado_at', null),
    supabase
      .from('pagos')
      .select('apoderado_id, aprobado_at')
      .in('apoderado_id', apoderadoIds)
      .eq('estado', 'APROBADO')
      .order('aprobado_at', { ascending: false }),
    cargoIds.length
      ? supabase.from('pago_detalle').select('cargo_id, monto, pagos!inner ( estado, aprobado_at )').in('cargo_id', cargoIds)
      : Promise.resolve({ data: [], error: null }),
    programa === 'STAR' && atletas.length
      ? supabase
          .from('star_orden_atletas')
          .select('atleta_id, star_ordenes!inner ( id, commerce_order, monto, estado, created_at )')
          .in('atleta_id', atletas.map((a) => a.id))
          .eq('star_ordenes.estado', 'PAGADA')
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [apR, linksR, pagosR, detR, kitsR]) if (r.error) throw r.error;

  const sitio = env.SITE_URL ?? 'https://firehousecheer.cl';
  const links: Record<string, string> = {};
  (linksR.data ?? []).forEach((l) => (links[l.apoderado_id as string] = urlCuenta(sitio, l.token as string)));
  const ultimoPago: Record<string, string> = {};
  (pagosR.data ?? []).forEach((p) => {
    if (p.aprobado_at && !ultimoPago[p.apoderado_id as string]) ultimoPago[p.apoderado_id as string] = p.aprobado_at as string;
  });

  // Kits del registro Star: ¿la orden ya está en la cuenta (pago con el mismo número)?
  type FilaKit = { atleta_id: string; star_ordenes: { id: string; commerce_order: string; monto: number; created_at: string } };
  const filasKit = (kitsR.data ?? []) as unknown as FilaKit[];
  const ordenes = unicos(filasKit.map((k) => k.star_ordenes.commerce_order));
  const registradasR = ordenes.length
    ? await supabase.from('pagos').select('commerce_order').in('commerce_order', ordenes)
    : { data: [], error: null };
  if (registradasR.error) throw registradasR.error;
  const registradas = new Set((registradasR.data ?? []).map((p) => p.commerce_order as string));
  const kits: KitRegistro[] = filasKit.map((k) => ({
    orden_id: k.star_ordenes.id,
    commerce_order: k.star_ordenes.commerce_order,
    atleta_id: k.atleta_id,
    monto: k.star_ordenes.monto,
    fecha: k.star_ordenes.created_at,
    registrado: registradas.has(k.star_ordenes.commerce_order),
  }));

  const apoderados = (apR.data ?? []) as ApoderadoFila[];
  const familias = armarFamilias({ apoderados, atletas, estadoCaso, cargos, kits, links, ultimoPago, hoy });

  type FilaDetalle = { cargo_id: string; monto: number; pagos: { estado: string; aprobado_at: string | null } };
  const detalles: DetallePago[] = ((detR.data ?? []) as unknown as FilaDetalle[]).map((d) => ({
    cargo_id: d.cargo_id,
    monto: d.monto,
    estado_pago: d.pagos.estado,
    aprobado_at: d.pagos.aprobado_at,
  }));
  const prueba = new Set(apoderados.filter((a) => a.es_prueba).map((a) => a.id));
  const cargosDePrueba = new Set(cargos.filter((c) => prueba.has(c.apoderado_id)).map((c) => c.id));

  return { programa, hoy, familias, totales: totalesPagos(familias, detalles, cargosDePrueba, hoy) };
}

async function buscar(supabase: SupabaseClient, texto: string) {
  const t = normalizarBusqueda(textoBusqueda(texto));
  if (t.length < 2) return { resultados: [] };
  // Pocas familias: se filtra aquí, sin importar tildes ni mayúsculas ("cespedes" encuentra "Céspedes").
  const { data, error } = await supabase
    .from('apoderados')
    .select('id, nombre, apellidos, telefono, email, es_prueba, atletas ( id, nombre, apellidos )')
    .order('nombre')
    .limit(3000);
  if (error) throw error;
  const palabras = t.split(' ');
  const resultados = (data ?? [])
    .filter((a) => {
      const atletas = (a.atletas as Array<{ nombre: string; apellidos: string }> | null) ?? [];
      const texto = normalizarBusqueda(
        [a.nombre, a.apellidos, a.email, a.telefono, ...atletas.map((x) => `${x.nombre} ${x.apellidos}`)].join(' '),
      );
      return palabras.every((p) => texto.includes(p));
    })
    .slice(0, 10);
  return { resultados };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const url = new URL(request.url);
  try {
    if (url.searchParams.has('buscar')) return jsonResponse(200, await buscar(admin.supabase, url.searchParams.get('buscar') ?? ''));
    const programa = url.searchParams.get('programa') ?? 'STAR';
    if (!esProgramaPagos(programa)) return jsonResponse(400, { error: 'programa_invalido' });
    return jsonResponse(200, await resumen(admin.supabase, env, programa));
  } catch (e) {
    console.error('admin_pagos_error', e instanceof Error ? e.message.slice(0, 200) : e);
    return jsonResponse(500, { error: 'no_disponible', mensaje: 'No se pudo leer el menú de pagos. ¿Está aplicada la migración 0013?' });
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

  if (accion === 'cargo_manual') {
    const v = validarCargoManual(b);
    if (!v.ok) return jsonResponse(400, { error: 'datos_invalidos', mensaje: v.error });
    const c = v.valor;
    if (c.atletaId) {
      const { data: atleta } = await supabase.from('atletas').select('apoderado_id').eq('id', c.atletaId).maybeSingle();
      if (!atleta || atleta.apoderado_id !== c.apoderadoId) {
        return jsonResponse(400, { error: 'datos_invalidos', mensaje: 'El deportista no pertenece a esta familia.' });
      }
    }
    const { error } = await supabase.from('cargos').insert({
      apoderado_id: c.apoderadoId,
      atleta_id: c.atletaId,
      programa_codigo: c.programa,
      concepto_codigo: c.concepto,
      temporada: Number(hoyChile().slice(0, 4)),
      descripcion: c.descripcion,
      monto: c.monto,
      monto_lista: c.monto,
      vencimiento: c.vencimiento,
      created_by: userId,
    });
    if (error) return jsonResponse(500, { error: 'no_se_pudo_crear', mensaje: 'No se pudo crear el cargo.' });
    return jsonResponse(200, { ok: true });
  }

  if (accion === 'registrar_kit') {
    const ordenId = String(b.ordenId ?? '');
    if (!UUID.test(ordenId)) return jsonResponse(400, { error: 'orden_invalida' });
    const { data, error } = await supabase.rpc('fn_registrar_kit_star_en_cuenta', { p_orden_id: ordenId, p_registrado_por: userId });
    if (error) {
      const m = error.message;
      const mensaje = m.includes('inscripciones_ya_pagadas')
        ? 'La inscripción de este deportista ya figura pagada en la cuenta: puede ser un pago doble. Revísalo en Mercado Pago.'
        : m.includes('orden_no_pagada')
          ? 'Esa orden del registro Star no está pagada.'
          : m.includes('orden_sin')
            ? 'La orden no tiene familia o deportistas asociados; regístrala a mano.'
            : 'No se pudo registrar el kit.';
      return jsonResponse(409, { error: 'rechazado', mensaje });
    }
    return jsonResponse(200, data);
  }

  if (accion === 'marcar_prueba') {
    const apoderadoId = String(b.apoderadoId ?? '');
    if (!UUID.test(apoderadoId)) return jsonResponse(400, { error: 'apoderado_invalido' });
    const { error } = await supabase.from('apoderados').update({ es_prueba: b.valor === true }).eq('id', apoderadoId);
    if (error) return jsonResponse(500, { error: 'no_se_pudo_guardar' });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(400, { error: 'accion_invalida' });
};
