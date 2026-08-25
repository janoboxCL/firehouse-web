// Guardia de sesión para el panel /admin. Cada página administrativa debe llamar a
// requireAdminSession() antes de mostrar cualquier dato. La seguridad real vive en RLS
// (is_admin() en Postgres); esto sólo evita mostrar una pantalla vacía/rota y redirige
// a personas no autenticadas o no activadas todavía.

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase-client.ts';

export interface AdminProfile {
  user_id: string;
  display_name: string | null;
  role: 'ADMIN' | 'GESTOR';
  active: boolean;
}

export interface SesionAdmin {
  supabase: SupabaseClient;
  session: Session;
  perfil: AdminProfile;
}

function irALogin(motivo?: string): void {
  const destino = motivo ? `/admin/login?motivo=${motivo}` : '/admin/login';
  window.location.href = destino;
}

/**
 * Resuelve con la sesión + perfil admin activo, o redirige a /admin/login y nunca resuelve
 * (para que el caller simplemente haga `return` tras el await sin lógica extra de control).
 */
export function requireAdminSession(): Promise<SesionAdmin> {
  return new Promise((resolve) => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error || !data.session) {
        irALogin();
        return;
      }

      const { data: perfil, error: errorPerfil } = await supabase
        .from('admin_profiles')
        .select('user_id, display_name, role, active')
        .eq('user_id', data.session.user.id)
        .maybeSingle();

      if (errorPerfil || !perfil || !perfil.active) {
        await supabase.auth.signOut();
        irALogin('inactivo');
        return;
      }

      resolve({ supabase, session: data.session, perfil: perfil as AdminProfile });
    });
  });
}

export async function cerrarSesion(): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
  window.location.href = '/admin/login';
}

/** Rellena el nombre en la cabecera y conecta el botón de cerrar sesión. Sin esto, cada
 * página tendría que repetir el mismo par de líneas. */
export function montarCabeceraAdmin(perfil: AdminProfile): void {
  const nombre = document.querySelector<HTMLElement>('#admin-usuario');
  if (nombre) nombre.textContent = perfil.display_name || perfil.role;

  const boton = document.querySelector<HTMLButtonElement>('#admin-logout');
  boton?.addEventListener('click', () => {
    cerrarSesion();
  });
}
