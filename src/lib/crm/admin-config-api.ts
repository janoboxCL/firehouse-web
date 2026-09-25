// Configuración de la academia desde el panel (migración 0012).
// Horarios, cobros y tallas se guardan directo con la sesión del admin (RLS);
// cargos de usuarios y pasarelas pasan por /api/admin/configuracion, que exige
// rol ADMIN.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  configDesdeFila,
  filaDesdeConfig,
  horarioDesdeFila,
  type ConfigAcademia,
  type HorarioClasePrueba,
} from './config-academia.ts';

export async function obtenerConfigAcademia(supabase: SupabaseClient): Promise<{ config: ConfigAcademia; disponible: boolean }> {
  const { data, error } = await supabase.from('configuracion_academia').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return { config: configDesdeFila(null), disponible: false };
  return { config: configDesdeFila(data as Record<string, unknown>), disponible: true };
}

export async function guardarConfigAcademia(supabase: SupabaseClient, c: ConfigAcademia): Promise<void> {
  const { error } = await supabase.from('configuracion_academia').update(filaDesdeConfig(c)).eq('id', 1);
  if (error) throw error;
}

/** `conHorario` es false si la migración 0012 aún no agrega las columnas de horario. */
export async function obtenerHorariosClasePrueba(
  supabase: SupabaseClient,
): Promise<{ horarios: HorarioClasePrueba[]; conHorario: boolean }> {
  const { data, error } = await supabase.from('configuracion_clase_prueba').select('*');
  if (error) throw error;
  const filas = (data ?? []) as Record<string, unknown>[];
  return { horarios: filas.map(horarioDesdeFila), conHorario: filas.some((f) => 'hora_inicio' in f) };
}

export async function guardarHorarioClasePrueba(supabase: SupabaseClient, h: HorarioClasePrueba, conHorario: boolean): Promise<void> {
  const cambios: Record<string, unknown> = { habilitado: h.habilitado };
  if (conHorario) Object.assign(cambios, { disciplina: h.disciplina, hora_inicio: h.horaInicio, hora_fin: h.horaFin });
  const { error } = await supabase.from('configuracion_clase_prueba').update(cambios).eq('dia', h.dia);
  if (error) throw error;
}

export interface UsuarioCrm {
  user_id: string;
  display_name: string | null;
  nombre_firma: string | null;
  cargo: string;
  role: 'ADMIN' | 'GESTOR';
  active: boolean;
}

export interface PasarelaCrm {
  id: 'FLOW' | 'MERCADOPAGO' | 'GETNET';
  habilitada: boolean;
  preferida: boolean;
  configurada: boolean;
}

export interface ConfigAdmin {
  esAdmin: boolean;
  usuarios: UsuarioCrm[];
  pasarelas: PasarelaCrm[];
}

async function llamar<T>(supabase: SupabaseClient, metodo: 'GET' | 'POST', cuerpo?: unknown): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  const r = await fetch('/api/admin/configuracion', {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const d = (await r.json().catch(() => ({}))) as T & { mensaje?: string; error?: string };
  if (!r.ok) throw new Error(d.mensaje ?? d.error ?? `Error ${r.status}`);
  return d;
}

export const obtenerConfigAdmin = (s: SupabaseClient) => llamar<ConfigAdmin>(s, 'GET');
export const cambiarCargo = (s: SupabaseClient, userId: string, cargo: string) =>
  llamar<ConfigAdmin>(s, 'POST', { accion: 'cargo', userId, cargo });
export const cambiarPasarela = (s: SupabaseClient, id: string, cambio: 'habilitar' | 'deshabilitar' | 'preferir') =>
  llamar<ConfigAdmin>(s, 'POST', { accion: 'pasarela', id, cambio });
