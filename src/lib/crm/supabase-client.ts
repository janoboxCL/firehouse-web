// Cliente Supabase para el navegador (panel /admin). Usa la anon key — nunca la
// service role key — y depende enteramente de RLS (ver supabase/migrations/0001_init.sql)
// para que sólo administradores activos puedan leer o escribir datos del CRM.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cliente: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cliente) return cliente;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Falta configurar PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY. Revisa el README (sección CRM).',
    );
  }

  cliente = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cliente;
}
