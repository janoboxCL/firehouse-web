// Acceso a datos de la Campaña Firehouse 2026 para el panel /admin. Usa el
// cliente autenticado de Supabase directo desde el navegador — la seguridad
// real vive en las políticas RLS (admin_select_campana_*), esto sólo arma
// las consultas. Mismo patrón que admin-concurso-api.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResumenCampana {
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
  const [{ data: ordenes, error: errOrdenes }, { data: pagos, error: errPagos }, { data: entradas, error: errEntradas }, pasarelas] =
    await Promise.all([
      supabase.from('campana_ordenes').select('estado'),
      supabase.from('campana_pagos').select('pasarela, monto, estado').eq('estado', 'APROBADO'),
      supabase.from('campana_entradas').select('origen, status'),
      obtenerPasarelasCampana(supabase),
    ]);
  if (errOrdenes) throw errOrdenes;
  if (errPagos) throw errPagos;
  if (errEntradas) throw errEntradas;

  const recaudadoPorPasarela: Record<string, number> = {};
  for (const p of pagos ?? []) {
    recaudadoPorPasarela[p.pasarela] = (recaudadoPorPasarela[p.pasarela] ?? 0) + p.monto;
  }

  return {
    ordenesPagadas: (ordenes ?? []).filter((o) => o.estado === 'PAGADA').length,
    ordenesPendientes: (ordenes ?? []).filter((o) => o.estado === 'PENDIENTE').length,
    recaudadoPorPasarela,
    entradasCompra: (entradas ?? []).filter((e) => e.origen === 'COMPRA' && e.status === 'ACTIVE').length,
    entradasGratis: (entradas ?? []).filter((e) => e.origen === 'GRATIS' && e.status === 'ACTIVE').length,
    entradasInvalidadas: (entradas ?? []).filter((e) => e.status === 'INVALIDATED').length,
    pasarelas,
  };
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
