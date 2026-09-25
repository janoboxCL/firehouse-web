// Lectura de la configuración de la academia desde el servidor (clave de
// servicio). Si la tabla aún no existe o falla la consulta, se usan los
// valores de respaldo: nunca se interrumpe un registro o un pago por esto.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  configDesdeFila,
  horarioDesdeFila,
  type ConfigAcademia,
  type HorarioClasePrueba,
} from '../../src/lib/crm/config-academia.ts';
import { MONTO_KIT_STAR } from '../../src/lib/crm/registro-star.ts';

export async function leerConfigAcademia(supabase: SupabaseClient): Promise<ConfigAcademia> {
  try {
    const { data } = await supabase.from('configuracion_academia').select('*').eq('id', 1).maybeSingle();
    return configDesdeFila(data as Record<string, unknown> | null);
  } catch {
    return configDesdeFila(null);
  }
}

export async function leerHorariosClasePrueba(supabase: SupabaseClient): Promise<HorarioClasePrueba[]> {
  try {
    const { data, error } = await supabase.from('configuracion_clase_prueba').select('*');
    if (error || !data) return [];
    return data.map((f) => horarioDesdeFila(f as Record<string, unknown>));
  } catch {
    return [];
  }
}

export interface PreciosStar {
  temporada: number;
  matricula: number;
  mensualidad: number;
}

/** Precios Star de una temporada; si no están configurados, los de respaldo. */
export async function leerPreciosStar(supabase: SupabaseClient, temporada: number): Promise<PreciosStar> {
  try {
    const { data } = await supabase
      .from('programa_precios')
      .select('matricula, mensualidad')
      .eq('programa_codigo', 'STAR')
      .eq('temporada', temporada)
      .maybeSingle();
    if (data) return { temporada, matricula: data.matricula as number, mensualidad: data.mensualidad as number };
  } catch {
    /* respaldo */
  }
  return { temporada, matricula: MONTO_KIT_STAR, mensualidad: 30000 };
}
