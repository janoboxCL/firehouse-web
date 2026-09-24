// Operaciones de servidor de la cuenta corriente familiar (migración 0011).
// Siempre con la clave de servicio; nunca se llaman desde el navegador.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  descripcionInscripcionStar,
  descripcionMensualidad,
  generarToken,
  mensualidadProrrateada,
  periodoDe,
  vencimientoMensualidad,
  type CargoSaldo,
} from '../../src/lib/crm/cuenta.ts';
import { getNextStarClassDate } from '../../src/lib/crm/star-class.ts';

export function primerNombre(n: string | null | undefined): string {
  return (n ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Devuelve el token vigente de la familia o crea uno nuevo. */
export async function obtenerOCrearToken(supabase: SupabaseClient, apoderadoId: string): Promise<string> {
  const { data } = await supabase.from('links_pago').select('token, revocado_at').eq('apoderado_id', apoderadoId).maybeSingle();
  if (data && !data.revocado_at) return data.token as string;
  const token = generarToken();
  const { error } = await supabase
    .from('links_pago')
    .upsert({ apoderado_id: apoderadoId, token, created_at: new Date().toISOString(), revocado_at: null, ultimo_uso_at: null }, { onConflict: 'apoderado_id' });
  if (error) throw error;
  return token;
}

export async function apoderadoPorToken(supabase: SupabaseClient, token: string): Promise<string | null> {
  const { data } = await supabase.from('links_pago').select('apoderado_id, revocado_at').eq('token', token).maybeSingle();
  if (!data || data.revocado_at) return null;
  return data.apoderado_id as string;
}

function esUnicoDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/**
 * Crea, si no existen, los cargos Star de un deportista: la inscripción (si el
 * kit no se pagó ya por el registro Star) y la mensualidad del mes de su
 * primera clase, proporcional según la semana.
 */
export async function asegurarCargosStar(
  supabase: SupabaseClient,
  atletaId: string,
  creadoPor: string | null,
): Promise<{ creados: string[]; fechaPrimeraClase: string }> {
  const { data: atleta, error: errAtleta } = await supabase.from('atletas').select('id, apoderado_id').eq('id', atletaId).single();
  if (errAtleta || !atleta) throw new Error('atleta_no_encontrado');

  const { data: casos } = await supabase
    .from('casos_crm')
    .select('journey, fecha_clase_prueba, created_at, programa')
    .eq('atleta_id', atletaId)
    .order('created_at', { ascending: false });
  const star = (casos ?? []).find((c) => c.programa === 'STAR' || c.journey === 'CLASE_PRUEBA_STAR' || c.journey === 'FIREHOUSE_STAR');
  if (!star) throw new Error('sin_caso_star');
  const fechaPrimeraClase =
    star.journey === 'CLASE_PRUEBA_STAR' && star.fecha_clase_prueba
      ? (star.fecha_clase_prueba as string)
      : getNextStarClassDate(new Date(star.created_at as string));

  const temporada = Number(fechaPrimeraClase.slice(0, 4));
  const { data: precio } = await supabase
    .from('programa_precios')
    .select('matricula, mensualidad')
    .eq('programa_codigo', 'STAR')
    .eq('temporada', temporada)
    .maybeSingle();
  if (!precio) throw new Error('sin_precios_star');

  const creados: string[] = [];

  // Kit ya pagado por el registro Star (star_ordenes): no se vuelve a cobrar.
  const { data: kit } = await supabase
    .from('star_orden_atletas')
    .select('orden_id, star_ordenes!inner(estado)')
    .eq('atleta_id', atletaId)
    .eq('star_ordenes.estado', 'PAGADA')
    .limit(1);
  if (!kit || kit.length === 0) {
    const { error } = await supabase.from('cargos').insert({
      apoderado_id: atleta.apoderado_id,
      atleta_id: atletaId,
      programa_codigo: 'STAR',
      concepto_codigo: 'INSCRIPCION',
      temporada,
      descripcion: descripcionInscripcionStar(temporada),
      monto: precio.matricula,
      monto_lista: precio.matricula,
      vencimiento: fechaPrimeraClase,
      created_by: creadoPor,
    });
    if (error && !esUnicoDuplicado(error)) throw error;
    if (!error) creados.push('INSCRIPCION');
  }

  const periodo = periodoDe(fechaPrimeraClase);
  const monto = mensualidadProrrateada(precio.mensualidad as number, fechaPrimeraClase);
  const vencDia5 = vencimientoMensualidad(periodo);
  const { error: errMes } = await supabase.from('cargos').insert({
    apoderado_id: atleta.apoderado_id,
    atleta_id: atletaId,
    programa_codigo: 'STAR',
    concepto_codigo: 'MENSUALIDAD',
    temporada,
    periodo,
    descripcion: descripcionMensualidad('Firehouse Star', periodo, monto !== precio.mensualidad),
    monto,
    monto_lista: precio.mensualidad,
    vencimiento: fechaPrimeraClase > vencDia5 ? fechaPrimeraClase : vencDia5,
    created_by: creadoPor,
  });
  if (errMes && !esUnicoDuplicado(errMes)) throw errMes;
  if (!errMes) creados.push('MENSUALIDAD');

  return { creados, fechaPrimeraClase };
}

export interface CargoConAtleta extends CargoSaldo {
  atleta_nombre: string | null;
  programa_codigo: string | null;
  created_at: string;
}

export interface PagoResumen {
  id: string;
  commerce_order: string;
  medio: string;
  monto_total: number;
  estado: string;
  referencia: string | null;
  pasarela_payment_id: string | null;
  aprobado_at: string | null;
  created_at: string;
  detalle: Array<{ cargo_id: string; monto: number }>;
}

export async function estadoCuenta(supabase: SupabaseClient, apoderadoId: string) {
  const [{ data: apoderado }, { data: cargos, error: errC }, { data: pagos, error: errP }, { data: atletas }] = await Promise.all([
    supabase.from('apoderados').select('id, nombre, email').eq('id', apoderadoId).single(),
    supabase
      .from('v_cargos_saldo')
      .select('id, atleta_id, programa_codigo, concepto_codigo, periodo, descripcion, monto, saldo, vencimiento, estado, created_at')
      .eq('apoderado_id', apoderadoId)
      .order('created_at'),
    supabase
      .from('pagos')
      .select('id, commerce_order, medio, monto_total, estado, referencia, pasarela_payment_id, aprobado_at, created_at, pago_detalle ( cargo_id, monto )')
      .eq('apoderado_id', apoderadoId)
      .order('created_at', { ascending: false }),
    supabase.from('atletas').select('id, nombre').eq('apoderado_id', apoderadoId),
  ]);
  if (errC) throw errC;
  if (errP) throw errP;
  const nombres = new Map((atletas ?? []).map((a) => [a.id as string, primerNombre(a.nombre as string)]));
  return {
    apoderado: apoderado as { id: string; nombre: string; email: string } | null,
    atletas: (atletas ?? []).map((a) => ({ id: a.id as string, nombre: primerNombre(a.nombre as string) })),
    cargos: (cargos ?? []).map((c) => ({ ...c, atleta_nombre: c.atleta_id ? nombres.get(c.atleta_id as string) ?? null : null })) as CargoConAtleta[],
    pagos: (pagos ?? []).map((p) => ({ ...p, detalle: (p as { pago_detalle?: unknown[] }).pago_detalle ?? [] })) as unknown as PagoResumen[],
  };
}
