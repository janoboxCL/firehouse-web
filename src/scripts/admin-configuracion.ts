import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import { obtenerDiasClasePrueba, guardarDiasClasePrueba } from '../lib/crm/admin-api.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function mostrarError(mensaje: string): void {
  $('#cfg-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#cfg-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

export async function iniciarConfiguracion(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  try {
    const dias = await obtenerDiasClasePrueba(supabase);
    $<HTMLInputElement>('#cfg-viernes')!.checked = dias.viernes;
    $<HTMLInputElement>('#cfg-sabado')!.checked = dias.sabado;
  } catch {
    mostrarError('No pudimos cargar la configuración. Recarga la página o inténtalo más tarde.');
    return;
  }

  $('#cfg-cargando')?.setAttribute('hidden', '');
  $<HTMLFormElement>('#cfg-form')!.hidden = false;

  $<HTMLFormElement>('#cfg-form')!.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const guardado = $<HTMLElement>('#cfg-guardado')!;
    guardado.hidden = true;
    try {
      await guardarDiasClasePrueba(supabase, {
        viernes: $<HTMLInputElement>('#cfg-viernes')!.checked,
        sabado: $<HTMLInputElement>('#cfg-sabado')!.checked,
      });
      guardado.hidden = false;
      setTimeout(() => (guardado.hidden = true), 2500);
    } catch {
      mostrarError('No pudimos guardar los cambios. Inténtalo nuevamente.');
    }
  });
}
