import { getSupabaseClient } from '../lib/crm/supabase-client.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function mostrarAviso(mensaje: string): void {
  const aviso = $<HTMLElement>('#login-aviso');
  if (!aviso) return;
  aviso.textContent = mensaje;
  aviso.hidden = false;
}

function leerMotivoQuery(): string | null {
  return new URLSearchParams(window.location.search).get('motivo');
}

export function iniciarLogin(): void {
  const motivo = leerMotivoQuery();
  if (motivo === 'inactivo') {
    mostrarAviso('Tu cuenta existe pero todavía no ha sido activada. Contacta a un administrador de Firehouse.');
  }

  // Si ya hay sesión activa y válida, no tiene sentido mostrar el login de nuevo.
  const supabase = getSupabaseClient();
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) window.location.href = '/admin';
  });

  const form = $<HTMLFormElement>('#form-login');
  const boton = $<HTMLButtonElement>('#login-boton');
  if (!form || !boton) return;

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const correo = $<HTMLInputElement>('#login-correo')!.value.trim();
    const clave = $<HTMLInputElement>('#login-clave')!.value;

    boton.disabled = true;
    boton.textContent = 'Ingresando…';

    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });

    if (error) {
      mostrarAviso('Correo o contraseña incorrectos.');
      boton.disabled = false;
      boton.textContent = 'Ingresar';
      return;
    }

    window.location.href = '/admin';
  });
}
