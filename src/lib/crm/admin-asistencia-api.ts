// Acceso a Supabase para la asistencia por fecha (migración 0016).
// Corre en el navegador con la sesión del admin; la seguridad real es RLS.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AsistenciasCargadas {
  /** false si la migración 0016 aún no está aplicada. */
  disponible: boolean;
  /** fecha (YYYY-MM-DD) → atleta_id con asistencia grabada. */
  porFecha: Map<string, Set<string>>;
}

export interface DeportistaAsistencia {
  atleta_id: string;
  caso_id: string;
}

function faltaMigracion(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    (msg.includes('asistencia') && (msg.includes('does not exist') || msg.includes('could not find')))
  );
}

export async function obtenerAsistencias(supabase: SupabaseClient, fechas: string[]): Promise<AsistenciasCargadas> {
  const porFecha = new Map<string, Set<string>>();
  fechas.forEach((f) => porFecha.set(f, new Set()));
  if (fechas.length === 0) return { disponible: true, porFecha };
  const { data, error } = await supabase.from('asistencias').select('atleta_id, fecha').in('fecha', fechas);
  if (error) {
    if (faltaMigracion(error)) return { disponible: false, porFecha };
    throw error;
  }
  (data ?? []).forEach((r) => porFecha.get(r.fecha as string)?.add(r.atleta_id as string));
  return { disponible: true, porFecha };
}

/** Graba los cambios de una fecha en una sola operación (fn_grabar_asistencia). */
export async function grabarAsistencia(
  supabase: SupabaseClient,
  fecha: string,
  presentes: DeportistaAsistencia[],
  ausentes: DeportistaAsistencia[],
): Promise<void> {
  const { error } = await supabase.rpc('fn_grabar_asistencia', {
    p_fecha: fecha,
    p_presentes: presentes,
    p_ausentes: ausentes,
  });
  if (error) {
    if (faltaMigracion(error)) throw new Error('Falta ejecutar la migración 0016 en Supabase para grabar la asistencia.');
    throw error;
  }
}
