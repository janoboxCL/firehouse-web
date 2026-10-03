// Ficha de la familia para el link de pago (migración 0019). Siempre con la
// clave de servicio y solo después de validar el token del link.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ficha } from '../../src/lib/crm/ficha.ts';
import { calcularEdad } from '../../src/lib/crm/validation.ts';

/**
 * Datos actuales de la familia para prellenar el formulario. Devuelve null si
 * la migración 0019 aún no está aplicada: en ese caso la página sigue
 * funcionando como antes, sin el paso de confirmación.
 */
export async function leerFicha(supabase: SupabaseClient, apoderadoId: string): Promise<Ficha | null> {
  const [ap, at] = await Promise.all([
    supabase.from('apoderados').select('nombre, apellidos, telefono, email, comuna, relacion, ficha_confirmada_at').eq('id', apoderadoId).maybeSingle(),
    supabase.from('atletas').select('id, nombre, apellidos, fecha_nacimiento, fecha_nacimiento_estimada, talla_polera, created_at').eq('apoderado_id', apoderadoId).order('created_at'),
  ]);
  if (ap.error || at.error || !ap.data) return null;
  const limpio = (v: unknown) => {
    const t = String(v ?? '').trim();
    return t === '—' ? '' : t;
  };
  return {
    confirmada: !!ap.data.ficha_confirmada_at,
    apoderado: {
      nombre: limpio(ap.data.nombre),
      apellidos: limpio(ap.data.apellidos),
      telefono: limpio(ap.data.telefono),
      email: limpio(ap.data.email),
      comuna: limpio(ap.data.comuna),
      relacion: limpio(ap.data.relacion),
    },
    atletas: (at.data ?? []).map((a) => {
      const estimada = !!a.fecha_nacimiento_estimada;
      return {
        id: a.id as string,
        nombre: limpio(a.nombre),
        apellidos: limpio(a.apellidos),
        // En recepción solo se anotó la edad: la fecha exacta la completa la familia.
        fechaNacimiento: estimada ? '' : (a.fecha_nacimiento as string),
        edadDeclarada: estimada ? calcularEdad(a.fecha_nacimiento as string)?.edad ?? null : null,
        talla: limpio(a.talla_polera),
      };
    }),
  };
}
