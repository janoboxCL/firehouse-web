// Capa de acceso a datos del panel admin. Las funciones puras (ordenar, filtrar, vencido)
// están separadas de las funciones que hablan con Supabase para poder testearlas sin red.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ESTADOS_CERRADOS, CRM_ESTADOS } from './constants.ts';
import { calcularEdad } from './validation.ts';

export interface ApoderadoResumen {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  telefono_secundario: string | null;
  email: string;
  comuna: string;
  relacion: string;
  canal_preferido: string;
  possible_duplicate: boolean;
  duplicate_reason: string | null;
}

export interface AtletaResumen {
  id: string;
  nombre: string;
  apellidos: string;
  fecha_nacimiento: string;
  firehouse_actual: boolean;
  tiene_experiencia: boolean | null;
  anos_experiencia: string | null;
  academia_anterior: string | null;
  fuera_rango_habitual: boolean;
  apoderado: ApoderadoResumen;
}

export interface CasoResumen {
  id: string;
  journey: string;
  estado: string;
  intencion_inicial: string | null;
  como_conocio: string;
  comentario_inicial: string | null;
  responsable_id: string | null;
  proxima_accion: string | null;
  fecha_proxima_accion: string | null;
  prioridad: string;
  created_at: string;
  updated_at: string;
  atleta: AtletaResumen;
}

export interface Interaccion {
  id: string;
  caso_id: string;
  tipo: string;
  nota: string | null;
  responsable_id: string | null;
  fecha: string;
}

export interface AdminMini {
  user_id: string;
  display_name: string | null;
  role: string;
}

const SELECT_CASO = `
  id, journey, estado, intencion_inicial, como_conocio, comentario_inicial,
  responsable_id, proxima_accion, fecha_proxima_accion, prioridad, created_at, updated_at,
  atleta:atletas (
    id, nombre, apellidos, fecha_nacimiento, firehouse_actual, tiene_experiencia,
    anos_experiencia, academia_anterior, fuera_rango_habitual,
    apoderado:apoderados (
      id, nombre, apellidos, telefono, telefono_secundario, email, comuna, relacion,
      canal_preferido, possible_duplicate, duplicate_reason
    )
  )
`;

export async function obtenerCasos(supabase: SupabaseClient): Promise<CasoResumen[]> {
  const { data, error } = await supabase
    .from('casos_crm')
    .select(SELECT_CASO)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as CasoResumen[];
}

export async function obtenerCasoPorId(supabase: SupabaseClient, id: string): Promise<CasoResumen | null> {
  const { data, error } = await supabase.from('casos_crm').select(SELECT_CASO).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as CasoResumen) ?? null;
}

export async function obtenerAdmins(supabase: SupabaseClient): Promise<AdminMini[]> {
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('user_id, display_name, role')
    .eq('active', true)
    .order('display_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function obtenerInteracciones(supabase: SupabaseClient, casoId: string): Promise<Interaccion[]> {
  const { data, error } = await supabase
    .from('interacciones')
    .select('id, caso_id, tipo, nota, responsable_id, fecha')
    .eq('caso_id', casoId)
    .order('fecha', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface CambiosCaso {
  estado?: string;
  responsable_id?: string | null;
  proxima_accion?: string | null;
  fecha_proxima_accion?: string | null;
  prioridad?: string;
}

export async function actualizarCaso(supabase: SupabaseClient, id: string, cambios: CambiosCaso): Promise<void> {
  const { error } = await supabase.from('casos_crm').update(cambios).eq('id', id);
  if (error) throw error;
}

export async function agregarInteraccion(
  supabase: SupabaseClient,
  casoId: string,
  tipo: string,
  nota: string,
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const { error } = await supabase.from('interacciones').insert({
    caso_id: casoId,
    tipo,
    nota,
    responsable_id: session?.user.id ?? null,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Lógica pura (sin red): filtros, orden y estado de vencimiento.
// ---------------------------------------------------------------------------

export function edadDeAtleta(atleta: Pick<AtletaResumen, 'fecha_nacimiento'>, ahora: Date = new Date()): number | null {
  return calcularEdad(atleta.fecha_nacimiento, ahora)?.edad ?? null;
}

function inicioDeHoy(ahora: Date): Date {
  const d = new Date(ahora);
  d.setHours(0, 0, 0, 0);
  return d;
}
function finDeHoy(ahora: Date): Date {
  const d = new Date(ahora);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function casoEstaCerrado(caso: Pick<CasoResumen, 'estado'>): boolean {
  return ESTADOS_CERRADOS.includes(caso.estado);
}

export function casoEstaVencido(caso: Pick<CasoResumen, 'estado' | 'fecha_proxima_accion'>, ahora: Date = new Date()): boolean {
  if (casoEstaCerrado(caso) || !caso.fecha_proxima_accion) return false;
  return new Date(caso.fecha_proxima_accion).getTime() < inicioDeHoy(ahora).getTime();
}

export function casoEsParaHoy(caso: Pick<CasoResumen, 'estado' | 'fecha_proxima_accion'>, ahora: Date = new Date()): boolean {
  if (casoEstaCerrado(caso) || !caso.fecha_proxima_accion) return false;
  const t = new Date(caso.fecha_proxima_accion).getTime();
  return t >= inicioDeHoy(ahora).getTime() && t <= finDeHoy(ahora).getTime();
}

export interface FiltrosCasos {
  journey?: string; // '' o undefined = todos
  estado?: string;
  responsableId?: string;
  fecha?: 'HOY' | 'ATRASADOS' | 'SEMANA' | 'TODOS';
  busqueda?: string;
}

export function coincideBusqueda(caso: CasoResumen, textoCrudo: string): boolean {
  const texto = textoCrudo.trim().toLowerCase();
  if (!texto) return true;
  const { atleta } = caso;
  const campos = [
    atleta.nombre,
    atleta.apellidos,
    atleta.apoderado.nombre,
    atleta.apoderado.apellidos,
    atleta.apoderado.telefono,
    atleta.apoderado.email,
  ];
  return campos.some((c) => c?.toLowerCase().includes(texto));
}

export function filtrarCasos(casos: CasoResumen[], filtros: FiltrosCasos, ahora: Date = new Date()): CasoResumen[] {
  const finSemana = new Date(ahora);
  finSemana.setDate(finSemana.getDate() + (7 - finSemana.getDay()));
  finSemana.setHours(23, 59, 59, 999);

  return casos.filter((caso) => {
    if (filtros.journey && caso.journey !== filtros.journey) return false;
    if (filtros.estado && caso.estado !== filtros.estado) return false;
    if (filtros.responsableId && caso.responsable_id !== filtros.responsableId) return false;

    if (filtros.fecha === 'HOY' && !casoEsParaHoy(caso, ahora)) return false;
    if (filtros.fecha === 'ATRASADOS' && !casoEstaVencido(caso, ahora)) return false;
    if (filtros.fecha === 'SEMANA') {
      if (!caso.fecha_proxima_accion || casoEstaCerrado(caso)) return false;
      const t = new Date(caso.fecha_proxima_accion).getTime();
      if (t < inicioDeHoy(ahora).getTime() || t > finSemana.getTime()) return false;
    }

    if (filtros.busqueda && !coincideBusqueda(caso, filtros.busqueda)) return false;

    return true;
  });
}

/**
 * Orden comercial por defecto:
 * 1) acciones vencidas · 2) acciones para hoy · 3) casos nuevos · 4) resto por fecha de creación.
 */
export function ordenarCasos(casos: CasoResumen[], ahora: Date = new Date()): CasoResumen[] {
  function bucket(c: CasoResumen): number {
    if (casoEstaVencido(c, ahora)) return 0;
    if (casoEsParaHoy(c, ahora)) return 1;
    if (c.estado === CRM_ESTADOS.NUEVO) return 2;
    return 3;
  }

  return [...casos].sort((a, b) => {
    const diff = bucket(a) - bucket(b);
    if (diff !== 0) return diff;

    if (bucket(a) <= 1) {
      // dentro de vencidas/hoy: la fecha más antigua primero (más urgente)
      const fa = a.fecha_proxima_accion ? new Date(a.fecha_proxima_accion).getTime() : Infinity;
      const fb = b.fecha_proxima_accion ? new Date(b.fecha_proxima_accion).getTime() : Infinity;
      return fa - fb;
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function casoSinProximaAccion(caso: Pick<CasoResumen, 'estado' | 'proxima_accion'>): boolean {
  return !casoEstaCerrado(caso) && !caso.proxima_accion;
}

export function nombreAdminDe(admins: AdminMini[], id: string | null): string {
  if (!id) return '—';
  const admin = admins.find((a) => a.user_id === id);
  return admin?.display_name || '—';
}
