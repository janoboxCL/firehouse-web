import type { SupabaseClient } from '@supabase/supabase-js';
import { limpiarRut } from './rut.ts';

export const CAMPAIGN_ID = 'FIREHOUSE_2026';
export const CAMPAIGN_BASES_VERSION = '2026-1.0';
export const CAMPAIGN_PRIVACY_VERSION = '2026-1.0';
export const MAX_PARTICIPACIONES = 3;

/**
 * RUT normalizado para identificar a la persona: sin puntos ni guion, DV en
 * mayúscula y sin ceros a la izquierda ("012.345.678-5" y "12345678-5" son la
 * misma persona).
 */
export function normalizarRutIdentidad(rut: string): string {
  return limpiarRut(rut).replace(/^0+(?=\d)/, '');
}

export function enmascararRut(rut: string): string {
  const limpio = normalizarRutIdentidad(rut);
  const cuerpo = limpio.slice(0, -1);
  return `${cuerpo.slice(0, 2)}.***.***-${limpio.slice(-1)}`;
}

export async function identityHash(rut: string, secret: string): Promise<string> {
  return hmacHex(normalizarRutIdentidad(rut), secret);
}

export async function hmacHex(valor: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(valor));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface DatosParticipante {
  rut: string;
  nombre: string;
  email: string;
  telefono: string;
  basesVersion: string;
}

/**
 * Devuelve el participante de este RUT, creándolo si no existe. Si ya existe NO
 * sobrescribe su nombre, correo ni teléfono: así nadie puede reemplazar los datos
 * de contacto de otra persona escribiendo su RUT en un formulario.
 */
export async function obtenerOCrearParticipante(
  supabase: SupabaseClient,
  secret: string,
  datos: DatosParticipante,
): Promise<{ id: string } | null> {
  const hash = await identityHash(datos.rut, secret);
  const ahora = new Date().toISOString();
  const { error } = await supabase.from('campana_participantes').upsert(
    {
      campaign_id: CAMPAIGN_ID,
      identity_hash: hash,
      rut_masked: enmascararRut(datos.rut),
      nombre: datos.nombre,
      email: datos.email,
      telefono: datos.telefono,
      bases_version: datos.basesVersion,
      bases_accepted_at: ahora,
      updated_at: ahora,
    },
    { onConflict: 'campaign_id,identity_hash', ignoreDuplicates: true },
  );
  if (error) return null;
  const { data } = await supabase
    .from('campana_participantes')
    .select('id')
    .eq('campaign_id', CAMPAIGN_ID)
    .eq('identity_hash', hash)
    .maybeSingle();
  return data ?? null;
}

/** ¿Está la fecha actual dentro del periodo de la campaña? */
export function dentroDelPeriodo(inicio: string | null, cierre: string | null, ahora = Date.now()): boolean {
  if (!inicio || !cierre) return false;
  return ahora >= Date.parse(inicio) && ahora <= Date.parse(cierre);
}
