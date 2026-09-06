// Acceso a datos del Concurso Firehouse para el panel /admin. Usa el cliente
// autenticado de Supabase directo desde el navegador — la seguridad real vive
// en las políticas RLS (admin_select_rifa_*), esto sólo arma las consultas.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResumenConcurso {
  totalNumeros: number;
  vendidos: number;
  reservados: number;
  disponibles: number;
  recaudado: number;
  ventasPendientes: number;
}

export async function obtenerResumenConcurso(supabase: SupabaseClient): Promise<ResumenConcurso> {
  const [{ data: numeros, error: errNum }, { data: ventas, error: errVentas }] = await Promise.all([
    supabase.from('rifa_numeros').select('estado'),
    supabase.from('rifa_ventas').select('estado, monto'),
  ]);
  if (errNum) throw errNum;
  if (errVentas) throw errVentas;

  const totalNumeros = numeros?.length ?? 0;
  const vendidos = numeros?.filter((n) => n.estado === 'VENDIDO').length ?? 0;
  const reservados = numeros?.filter((n) => n.estado === 'RESERVADO').length ?? 0;
  const disponibles = totalNumeros - vendidos - reservados;

  const recaudado = (ventas ?? [])
    .filter((v) => v.estado === 'PAGADA')
    .reduce((acc, v) => acc + (v.monto ?? 0), 0);
  const ventasPendientes = (ventas ?? []).filter((v) => v.estado === 'PENDIENTE').length;

  return { totalNumeros, vendidos, reservados, disponibles, recaudado, ventasPendientes };
}

export interface VentaConcursoResumen {
  id: string;
  commerceOrder: string;
  compradorNombre: string;
  compradorEmail: string;
  compradorTelefono: string;
  cantidadNumeros: number;
  monto: number;
  estado: 'PENDIENTE' | 'PAGADA' | 'RECHAZADA' | 'ANULADA' | 'EXPIRADA';
  createdAt: string;
  paidAt: string | null;
  atletaNombre: string | null;
}

interface FilaVentaCruda {
  id: string;
  commerce_order: string;
  comprador_nombre: string;
  comprador_email: string;
  comprador_telefono: string;
  cantidad_numeros: number;
  monto: number;
  estado: VentaConcursoResumen['estado'];
  created_at: string;
  paid_at: string | null;
  rifa_codigos: { codigo: string; atletas: { nombre: string; apellidos: string } } | null;
}

export async function obtenerVentasConcurso(supabase: SupabaseClient): Promise<VentaConcursoResumen[]> {
  const { data, error } = await supabase
    .from('rifa_ventas')
    .select(
      `id, commerce_order, comprador_nombre, comprador_email, comprador_telefono,
       cantidad_numeros, monto, estado, created_at, paid_at,
       rifa_codigos ( codigo, atletas ( nombre, apellidos ) )`,
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  return ((data ?? []) as unknown as FilaVentaCruda[]).map((v) => ({
    id: v.id,
    commerceOrder: v.commerce_order,
    compradorNombre: v.comprador_nombre,
    compradorEmail: v.comprador_email,
    compradorTelefono: v.comprador_telefono,
    cantidadNumeros: v.cantidad_numeros,
    monto: v.monto,
    estado: v.estado,
    createdAt: v.created_at,
    paidAt: v.paid_at,
    atletaNombre: v.rifa_codigos ? `${v.rifa_codigos.atletas.nombre} ${v.rifa_codigos.atletas.apellidos}` : null,
  }));
}

export interface RankingAtletaConcurso {
  atleta: string;
  codigo: string;
  ticketsVendidos: number;
}

export interface RankingConcurso {
  ranking: RankingAtletaConcurso[];
  ventaGenerica: number;
}

interface FilaNumeroCruda {
  numero: number;
  rifa_ventas: {
    rifa_codigos: { codigo: string; atletas: { nombre: string; apellidos: string } } | null;
  } | null;
}

/** Ranking de tickets vendidos por atleta (solo VENDIDO = ya pagado). Los
 * tickets sin código de referido asociado se cuentan aparte como "venta genérica". */
export async function obtenerRankingConcurso(supabase: SupabaseClient): Promise<RankingConcurso> {
  const { data, error } = await supabase
    .from('rifa_numeros')
    .select(`numero, rifa_ventas!inner ( rifa_codigos ( codigo, atletas ( nombre, apellidos ) ) )`)
    .eq('estado', 'VENDIDO');
  if (error) throw error;

  const mapa = new Map<string, RankingAtletaConcurso>();
  let ventaGenerica = 0;

  for (const fila of (data ?? []) as unknown as FilaNumeroCruda[]) {
    const codigo = fila.rifa_ventas?.rifa_codigos;
    if (!codigo) {
      ventaGenerica++;
      continue;
    }
    const existente = mapa.get(codigo.codigo);
    if (existente) {
      existente.ticketsVendidos++;
    } else {
      mapa.set(codigo.codigo, {
        atleta: `${codigo.atletas.nombre} ${codigo.atletas.apellidos}`,
        codigo: codigo.codigo,
        ticketsVendidos: 1,
      });
    }
  }

  const ranking = [...mapa.values()].sort((a, b) => b.ticketsVendidos - a.ticketsVendidos);
  return { ranking, ventaGenerica };
}
