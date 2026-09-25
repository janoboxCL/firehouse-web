// Acceso a Supabase para mensajes con plantilla (migración 0009): firma de quien
// envía, plantillas de clase de prueba, registro de envíos y talla de polera.
// Corre en el navegador con la sesión del admin; la seguridad real es RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { primerNombre } from './plantillas.ts';
import { formatoPesos, hoyChile } from './programas.ts';

export interface Firma {
  nombre: string | null;
  cargo: string | null;
  nombreFirma: string | null;
  /** false si la migración 0009 aún no está aplicada. */
  disponible: boolean;
}

export interface PlantillaClasePrueba {
  id: string;
  nombre: string;
  canal: 'WHATSAPP' | 'EMAIL' | 'AMBOS';
  asunto: string | null;
  cuerpo: string;
  /** Versión correo (migración 0012). Si falta, el correo usa `cuerpo`. */
  cuerpo_email: string | null;
  orden: number;
}

export type CanalEnvio = 'WHATSAPP' | 'EMAIL';

export interface EnvioPlantilla {
  caso_id: string;
  plantilla_id: string;
  fecha: string;
  tipo: CanalEnvio;
}

export const sirveParaWhatsApp = (p: { canal: string }) => p.canal === 'WHATSAPP' || p.canal === 'AMBOS';
export const sirveParaCorreo = (p: { canal: string }) => p.canal === 'EMAIL' || p.canal === 'AMBOS';

async function usuarioActual(supabase: SupabaseClient): Promise<string | null> {
  return (await supabase.auth.getSession()).data.session?.user.id ?? null;
}

export async function obtenerFirma(supabase: SupabaseClient): Promise<Firma> {
  const userId = await usuarioActual(supabase);
  if (!userId) return { nombre: null, cargo: null, nombreFirma: null, disponible: false };
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('display_name, nombre_firma, cargo')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return { nombre: null, cargo: null, nombreFirma: null, disponible: false };
  const nombreFirma = (data.nombre_firma as string | null)?.trim() || null;
  return {
    nombre: nombreFirma ?? (primerNombre(data.display_name as string) || null),
    cargo: data.cargo as string,
    nombreFirma,
    disponible: true,
  };
}

export async function guardarNombreFirma(supabase: SupabaseClient, nombre: string): Promise<void> {
  const userId = await usuarioActual(supabase);
  if (!userId) throw new Error('Sin sesión activa.');
  const limpio = nombre.trim().slice(0, 60);
  const { error } = await supabase
    .from('admin_profiles')
    .update({ nombre_firma: limpio || null })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function obtenerPlantillasClasePrueba(supabase: SupabaseClient): Promise<PlantillaClasePrueba[]> {
  const { data, error } = await supabase
    .from('plantillas_mensaje')
    .select('id, nombre, canal, asunto, cuerpo, cuerpo_email, orden')
    .eq('categoria', 'CLASE_PRUEBA')
    .eq('activo', true)
    .order('orden');
  if (error) throw error;
  return (data ?? []) as PlantillaClasePrueba[];
}

export async function obtenerEnvios(supabase: SupabaseClient, casoIds: string[]): Promise<EnvioPlantilla[]> {
  if (casoIds.length === 0) return [];
  const { data, error } = await supabase
    .from('interacciones')
    .select('caso_id, plantilla_id, fecha, tipo')
    .in('caso_id', casoIds)
    .not('plantilla_id', 'is', null);
  if (error) throw error;
  return (data ?? []) as EnvioPlantilla[];
}

export async function registrarEnvio(
  supabase: SupabaseClient,
  casoId: string,
  plantilla: { id: string; nombre: string },
  canal: CanalEnvio = 'WHATSAPP',
): Promise<void> {
  const { error } = await supabase.from('interacciones').insert({
    caso_id: casoId,
    tipo: canal,
    nota: `Plantilla enviada por ${canal === 'EMAIL' ? 'correo' : 'WhatsApp'}: ${plantilla.nombre}`,
    responsable_id: await usuarioActual(supabase),
    plantilla_id: plantilla.id,
  });
  if (error) throw error;
}

export async function obtenerTallas(supabase: SupabaseClient, atletaIds: string[]): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  if (atletaIds.length === 0) return mapa;
  const { data, error } = await supabase.from('atletas').select('id, talla_polera').in('id', atletaIds);
  if (error) throw error;
  (data ?? []).forEach((a) => mapa.set(a.id as string, (a.talla_polera as string | null) ?? null));
  return mapa;
}

export async function guardarTalla(supabase: SupabaseClient, atletaId: string, talla: string | null): Promise<void> {
  const { error } = await supabase.from('atletas').update({ talla_polera: talla }).eq('id', atletaId);
  if (error) throw error;
}

/** Valor de la inscripción Star de la temporada actual, ej.: "$10.000". */
export async function obtenerValorInscripcionStar(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from('programa_precios')
    .select('matricula')
    .eq('programa_codigo', 'STAR')
    .eq('temporada', Number(hoyChile().slice(0, 4)))
    .maybeSingle();
  return data ? formatoPesos(data.matricula as number) : null;
}

/** Nota con la que se registra la asistencia a la primera clase de una inscripción Star. */
export const NOTA_ASISTENCIA_PRIMERA_CLASE = 'Asistió a su primera clase de Firehouse Star';

export async function obtenerAsistenciasPrimeraClase(supabase: SupabaseClient, casoIds: string[]): Promise<Set<string>> {
  if (casoIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('interacciones')
    .select('caso_id')
    .in('caso_id', casoIds)
    .eq('nota', NOTA_ASISTENCIA_PRIMERA_CLASE);
  if (error) throw error;
  return new Set((data ?? []).map((d) => d.caso_id as string));
}

/**
 * Registra la asistencia de una inscripción Star sin cambiar el estado del caso
 * (que refleja el pago: INSCRITO o pendiente).
 */
export async function registrarAsistenciaPrimeraClase(supabase: SupabaseClient, casoId: string): Promise<void> {
  const { error } = await supabase.from('interacciones').insert({
    caso_id: casoId,
    tipo: 'NOTA',
    nota: NOTA_ASISTENCIA_PRIMERA_CLASE,
    responsable_id: await usuarioActual(supabase),
  });
  if (error) throw error;
}
