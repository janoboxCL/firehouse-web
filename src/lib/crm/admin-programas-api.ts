// Acceso a Supabase para la configuración de programas (migración 0007).
// Corre en el navegador con la sesión del admin; la seguridad real es RLS (is_admin()).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CombinacionHermanos, PeriodoInscripcion, Programa } from './programas.ts';

export interface PrecioPrograma {
  programa_codigo: Programa;
  temporada: number;
  matricula: number;
  mensualidad: number;
}

export interface PrecioHermanos {
  temporada: number;
  combinacion: CombinacionHermanos;
  monto_total: number;
}

export interface ProgramaFila {
  codigo: Programa;
  nombre: string;
  descripcion: string | null;
  orden: number;
}

export interface ConfigProgramas {
  programas: ProgramaFila[];
  precios: PrecioPrograma[];
  hermanos: PrecioHermanos[];
  periodos: Array<PeriodoInscripcion & { id: string }>;
}

/** Error específico: las tablas aún no existen porque falta ejecutar la migración 0007. */
export class MigracionPendienteError extends Error {
  constructor() {
    super('MIGRACION_PENDIENTE');
  }
}

function esTablaInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the table/i.test(error.message ?? '')
  );
}

export async function obtenerConfigProgramas(supabase: SupabaseClient): Promise<ConfigProgramas> {
  const [programas, precios, hermanos, periodos] = await Promise.all([
    supabase.from('programas').select('codigo, nombre, descripcion, orden').order('orden'),
    supabase.from('programa_precios').select('programa_codigo, temporada, matricula, mensualidad').order('temporada'),
    supabase.from('precios_hermanos').select('temporada, combinacion, monto_total').order('temporada'),
    supabase
      .from('periodos_inscripcion')
      .select('id, programa_codigo, nombre, abre, cierra, clases_inician, activo')
      .order('abre'),
  ]);
  for (const r of [programas, precios, hermanos, periodos]) {
    if (esTablaInexistente(r.error)) throw new MigracionPendienteError();
    if (r.error) throw r.error;
  }
  return {
    programas: (programas.data ?? []) as ProgramaFila[],
    precios: (precios.data ?? []) as PrecioPrograma[],
    hermanos: (hermanos.data ?? []) as PrecioHermanos[],
    periodos: (periodos.data ?? []) as ConfigProgramas['periodos'],
  };
}

export async function guardarPrecios(
  supabase: SupabaseClient,
  precios: PrecioPrograma[],
  hermanos: PrecioHermanos[],
): Promise<void> {
  const r1 = await supabase.from('programa_precios').upsert(precios, { onConflict: 'programa_codigo,temporada' });
  if (r1.error) throw r1.error;
  const r2 = await supabase.from('precios_hermanos').upsert(hermanos, { onConflict: 'temporada,combinacion' });
  if (r2.error) throw r2.error;
}

export async function crearPeriodo(supabase: SupabaseClient, periodo: PeriodoInscripcion): Promise<void> {
  const { error } = await supabase.from('periodos_inscripcion').insert(periodo);
  if (error) throw error;
}

export async function actualizarPeriodo(
  supabase: SupabaseClient,
  id: string,
  cambios: Partial<PeriodoInscripcion>,
): Promise<void> {
  const { error } = await supabase.from('periodos_inscripcion').update(cambios).eq('id', id);
  if (error) throw error;
}

export async function eliminarPeriodo(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('periodos_inscripcion').delete().eq('id', id);
  if (error) throw error;
}
