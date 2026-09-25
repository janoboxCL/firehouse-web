import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import { guardarHorarioClasePrueba, obtenerHorariosClasePrueba } from '../lib/crm/admin-config-api.ts';
import { validarHorario, type HorarioClasePrueba } from '../lib/crm/config-academia.ts';
import { iniciarConfiguracionProgramas } from './admin-configuracion-programas.ts';
import { iniciarFirma } from './admin-configuracion-firma.ts';
import { iniciarConfiguracionAcademia } from './admin-configuracion-academia.ts';
import { iniciarUsuariosYPasarelas } from './admin-configuracion-usuarios.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function mostrarError(mensaje: string): void {
  $('#cfg-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#cfg-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

const DIAS = [
  { dia: 'VIERNES', check: '#cfg-viernes' },
  { dia: 'SABADO', check: '#cfg-sabado' },
] as const;

function campo(dia: string, nombre: string): HTMLInputElement {
  return $<HTMLInputElement>(`[data-horario="${dia}"] [data-campo="${nombre}"]`)!;
}

export async function iniciarConfiguracion(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  // Cada sección es independiente: si una falla, las demás siguen funcionando.
  void iniciarConfiguracionProgramas(supabase);
  void iniciarFirma(supabase);
  void iniciarConfiguracionAcademia(supabase);
  void iniciarUsuariosYPasarelas(supabase);

  let horarios: HorarioClasePrueba[];
  let conHorario: boolean;
  try {
    // Sin la migración 0012 no existen las columnas de horario: solo se editan los días.
    ({ horarios, conHorario } = await obtenerHorariosClasePrueba(supabase));
  } catch {
    mostrarError('No pudimos cargar la configuración. Recarga la página o inténtalo más tarde.');
    return;
  }
  for (const { dia, check } of DIAS) {
    const h = horarios.find((x) => x.dia === dia);
    $<HTMLInputElement>(check)!.checked = h?.habilitado === true;
    $<HTMLElement>(`[data-horario="${dia}"]`)!.hidden = !conHorario;
    if (h) {
      campo(dia, 'disciplina').value = h.disciplina ?? '';
      campo(dia, 'inicio').value = h.horaInicio ?? '';
      campo(dia, 'fin').value = h.horaFin ?? '';
    }
  }

  $('#cfg-cargando')?.setAttribute('hidden', '');
  $<HTMLFormElement>('#cfg-form')!.hidden = false;

  $<HTMLFormElement>('#cfg-form')!.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const guardado = $<HTMLElement>('#cfg-guardado')!;
    guardado.hidden = true;
    $<HTMLElement>('#cfg-error')!.hidden = true;

    const nuevos: HorarioClasePrueba[] = [];
    for (const { dia, check } of DIAS) {
      const h: HorarioClasePrueba = {
        dia,
        habilitado: $<HTMLInputElement>(check)!.checked,
        disciplina: campo(dia, 'disciplina').value.trim() || null,
        horaInicio: campo(dia, 'inicio').value || null,
        horaFin: campo(dia, 'fin').value || null,
      };
      if (conHorario) {
        const v = validarHorario(h);
        if (!v.ok) {
          mostrarError(v.error);
          return;
        }
      }
      nuevos.push(h);
    }
    try {
      for (const h of nuevos) await guardarHorarioClasePrueba(supabase, h, conHorario);
      guardado.hidden = false;
      setTimeout(() => (guardado.hidden = true), 2500);
    } catch {
      mostrarError('No pudimos guardar los cambios. Inténtalo nuevamente.');
    }
  });
}
