// Acceso a datos de la Campaña Firehouse 2026 para el panel /admin. Usa el
// cliente autenticado de Supabase directo desde el navegador — la seguridad
// real vive en las políticas RLS (admin_select_campana_*), esto sólo arma
// las consultas. Mismo patrón que admin-concurso-api.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResumenCampana {
  personasUnicas: number;
  personasPorTotal: Record<number, number>;
  emailsFallidos: number;
  ordenesPagadas: number;
  ordenesPendientes: number;
  recaudadoPorPasarela: Record<string, number>;
  entradasCompra: number;
  entradasGratis: number;
  entradasInvalidadas: number;
  pasarelas: PasarelaEstado[];
}

export interface PasarelaEstado {
  id: string;
  habilitada: boolean;
  preferida: boolean;
}

export interface OrdenCampana {
  id: string;
  commerceOrder: string;
  compradorNombre: string;
  compradorEmail: string;
  compradorTelefono: string;
  estado: string;
  createdAt: string;
  paidAt: string | null;
  monto: number;
  atletaReferido: string | null;
  items: {
    producto: string;
    precio: number;
    entregaEstado: string | null;
    codigo: string | null;
  }[];
  pago: {
    pasarela: string;
    estado: string;
    pasarelaPaymentId: string | null;
    metodoPago: string | null;
  } | null;
}

export interface ParticipacionGratisCampana {
  nombreCompleto: string;
  rut: string;
  email: string;
  telefono: string;
  createdAt: string;
  codigo: string | null;
}

export async function obtenerPasarelasCampana(supabase: SupabaseClient): Promise<PasarelaEstado[]> {
  const { data, error } = await supabase.from('campana_pasarelas').select('id, habilitada, preferida').order('id');
  if (error) throw error;
  return (data ?? []) as PasarelaEstado[];
}

export async function obtenerResumenCampana(supabase: SupabaseClient): Promise<ResumenCampana> {
  const [{ data: ordenes, error: errOrdenes }, { data: pagos, error: errPagos }, { data: entradas, error: errEntradas }, { data: participantes }, { data: emails }, pasarelas] =
    await Promise.all([
      supabase.from('campana_ordenes').select('estado'),
      supabase.from('campana_pagos').select('pasarela, monto, estado').eq('estado', 'APROBADO'),
      supabase.from('campana_entradas').select('origen, status'),
      supabase.from('campana_participantes').select('id, campana_entradas(status)'),
      supabase.from('campana_email_outbox').select('status').eq('status', 'FAILED'),
      obtenerPasarelasCampana(supabase),
    ]);
  if (errOrdenes) throw errOrdenes;
  if (errPagos) throw errPagos;
  if (errEntradas) throw errEntradas;

  const recaudadoPorPasarela: Record<string, number> = {};
  for (const p of pagos ?? []) {
    recaudadoPorPasarela[p.pasarela] = (recaudadoPorPasarela[p.pasarela] ?? 0) + p.monto;
  }

  const personasPorTotal: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const p of participantes ?? []) {
    const total = ((p as any).campana_entradas ?? []).filter((e: any) => e.status === 'ACTIVE').length;
    if (total >= 1 && total <= 3) personasPorTotal[total]++;
  }
  return {
    personasUnicas: participantes?.length ?? 0,
    personasPorTotal,
    emailsFallidos: emails?.length ?? 0,
    ordenesPagadas: (ordenes ?? []).filter((o) => o.estado === 'PAGADA').length,
    ordenesPendientes: (ordenes ?? []).filter((o) => o.estado === 'PENDIENTE').length,
    recaudadoPorPasarela,
    entradasCompra: (entradas ?? []).filter((e) => e.origen === 'COMPRA' && e.status === 'ACTIVE').length,
    entradasGratis: (entradas ?? []).filter((e) => e.origen === 'GRATIS' && e.status === 'ACTIVE').length,
    entradasInvalidadas: (entradas ?? []).filter((e) => e.status === 'INVALIDATED').length,
    pasarelas,
  };
}

export interface CorreoCampana {
  id: string;
  tipo: 'CONFIRMACION_COMPRA' | 'PARTICIPACION_GRATIS';
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
}

export interface ParticipanteCampana {
  id: string; nombre: string; rutMasked: string; email: string; compra: number; gratis: number;
  total: number; invalidadas: number; codigos: string[]; ordenes: string[]; correos: CorreoCampana[];
}

export async function obtenerParticipantesCampana(supabase: SupabaseClient): Promise<ParticipanteCampana[]> {
  const { data, error } = await supabase
    .from('campana_participantes')
    .select(
      `id, nombre, rut_masked, email,
       campana_entradas ( source, status, codigo, entry_no ),
       campana_ordenes ( commerce_order, estado ),
       campana_email_outbox ( id, tipo, status, attempts, last_error )`,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p: any) => {
    const entradas = [...(p.campana_entradas ?? [])].sort((a: any, b: any) => (a.entry_no ?? 0) - (b.entry_no ?? 0));
    const activas = entradas.filter((e: any) => e.status === 'ACTIVE');
    return {
      id: p.id,
      nombre: p.nombre,
      rutMasked: p.rut_masked,
      email: p.email,
      compra: activas.filter((e: any) => e.source === 'COMPRA').length,
      gratis: activas.filter((e: any) => e.source === 'GRATIS').length,
      total: activas.length,
      invalidadas: entradas.length - activas.length,
      codigos: activas.map((e: any) => e.codigo),
      ordenes: (p.campana_ordenes ?? []).map((o: any) => `${o.commerce_order} (${o.estado})`),
      correos: (p.campana_email_outbox ?? []).map((c: any) => ({
        id: c.id, tipo: c.tipo, status: c.status, attempts: c.attempts ?? 0, lastError: c.last_error ?? null,
      })),
    };
  });
}

/** Reenvía un correo del outbox sin generar participaciones nuevas. */
export async function reenviarCorreoCampana(supabase: SupabaseClient, outboxId: string): Promise<void> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  const r = await fetch('/api/admin/campana-reenviar-correo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ outboxId }),
  });
  if (!r.ok) {
    const cuerpo = (await r.json().catch(() => ({}))) as { detalle?: string; error?: string };
    throw new Error(cuerpo.detalle ?? cuerpo.error ?? `Error ${r.status}`);
  }
}

export async function obtenerOrdenesCampana(supabase: SupabaseClient, limite = 200): Promise<OrdenCampana[]> {
  const { data, error } = await supabase
    .from('campana_ordenes')
    .select(
      `id, commerce_order, comprador_nombre, comprador_email, comprador_telefono, estado, created_at, paid_at, monto,
       rifa_codigos ( atletas ( nombre ) ),
       campana_orden_items (
         producto, precio,
         campana_entregas ( estado ),
         campana_entradas ( codigo )
       ),
       campana_pagos ( pasarela, estado, pasarela_payment_id, metodo_pago )`,
    )
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;

  return (data ?? []).map((o: any) => ({
    id: o.id,
    commerceOrder: o.commerce_order,
    compradorNombre: o.comprador_nombre,
    compradorEmail: o.comprador_email,
    compradorTelefono: o.comprador_telefono,
    estado: o.estado,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    monto: o.monto,
    atletaReferido: o.rifa_codigos?.atletas?.nombre ?? null,
    items: (o.campana_orden_items ?? []).map((i: any) => ({
      producto: i.producto,
      precio: i.precio,
      entregaEstado: i.campana_entregas?.estado ?? i.campana_entregas?.[0]?.estado ?? null,
      codigo: i.campana_entradas?.[0]?.codigo ?? i.campana_entradas?.codigo ?? null,
    })),
    pago: o.campana_pagos?.[0]
      ? {
          pasarela: o.campana_pagos[0].pasarela,
          estado: o.campana_pagos[0].estado,
          pasarelaPaymentId: o.campana_pagos[0].pasarela_payment_id,
          metodoPago: o.campana_pagos[0].metodo_pago,
        }
      : null,
  }));
}

export async function obtenerParticipacionesGratisCampana(supabase: SupabaseClient): Promise<ParticipacionGratisCampana[]> {
  const { data, error } = await supabase
    .from('campana_entradas_gratis')
    .select('nombre_completo, rut, email, telefono, created_at, campana_entradas ( codigo )')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    nombreCompleto: r.nombre_completo,
    rut: r.rut,
    email: r.email,
    telefono: r.telefono,
    createdAt: r.created_at,
    codigo: r.campana_entradas?.[0]?.codigo ?? r.campana_entradas?.codigo ?? null,
  }));
}
