import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerPlantillas,
  crearPlantilla,
  actualizarPlantilla,
  eliminarPlantilla,
  type PlantillaMensaje,
  type CanalPlantilla,
} from '../lib/crm/admin-api.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

const CANAL_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Correo', AMBOS: 'WhatsApp y correo' };

function mostrarError(mensaje: string): void {
  const el = $<HTMLElement>('#pl-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function actualizarVisibilidadAsunto(): void {
  const canal = $<HTMLSelectElement>('#pl-canal')!.value;
  $<HTMLElement>('#pl-asunto-wrap')!.hidden = canal === 'WHATSAPP';
}

function limpiarFormulario(): void {
  $<HTMLInputElement>('#pl-id')!.value = '';
  $<HTMLFormElement>('#pl-form')!.reset();
  $<HTMLInputElement>('#pl-activo')!.checked = true;
  actualizarVisibilidadAsunto();
  $('#pl-form-titulo')!.textContent = 'Nueva plantilla';
  $<HTMLButtonElement>('#pl-btn-cancelar')!.hidden = true;
}

function cargarEnFormulario(p: PlantillaMensaje): void {
  $<HTMLInputElement>('#pl-id')!.value = p.id;
  $<HTMLInputElement>('#pl-nombre')!.value = p.nombre;
  $<HTMLSelectElement>('#pl-canal')!.value = p.canal;
  $<HTMLInputElement>('#pl-asunto')!.value = p.asunto ?? '';
  $<HTMLTextAreaElement>('#pl-cuerpo')!.value = p.cuerpo;
  $<HTMLInputElement>('#pl-activo')!.checked = p.activo;
  actualizarVisibilidadAsunto();
  $('#pl-form-titulo')!.textContent = `Editando: ${p.nombre}`;
  $<HTMLButtonElement>('#pl-btn-cancelar')!.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderLista(plantillas: PlantillaMensaje[], supabase: SupabaseClient, onCambio: () => void): void {
  const contenedor = $<HTMLElement>('#pl-lista')!;
  const vacio = $<HTMLElement>('#pl-vacio')!;
  contenedor.innerHTML = '';

  if (plantillas.length === 0) {
    vacio.hidden = false;
    return;
  }
  vacio.hidden = true;

  plantillas.forEach((p) => {
    const item = document.createElement('div');
    item.className = `pl-item${p.activo ? '' : ' pl-item--inactiva'}`;
    item.innerHTML = `
      <div>
        <p class="pl-item__nombre">${p.nombre} · <span class="admin-badge admin-badge--journey">${CANAL_LABEL[p.canal] ?? p.canal}</span>${p.activo ? '' : ' <span class="admin-badge admin-badge--estado-cerrado-no">Inactiva</span>'}</p>
        <p class="pl-item__cuerpo">${p.cuerpo}</p>
      </div>
      <div class="pl-item__acciones">
        <button type="button" class="pl-item__accion pl-item__accion--editar">Editar</button>
        <button type="button" class="pl-item__accion pl-item__accion--eliminar">Eliminar</button>
      </div>
    `;
    item.querySelector('.pl-item__accion--editar')!.addEventListener('click', () => cargarEnFormulario(p));
    item.querySelector('.pl-item__accion--eliminar')!.addEventListener('click', async () => {
      const confirmado = window.confirm(`¿Eliminar la plantilla "${p.nombre}"? No se puede deshacer.`);
      if (!confirmado) return;
      try {
        await eliminarPlantilla(supabase, p.id);
        onCambio();
      } catch {
        mostrarError('No pudimos eliminar la plantilla. Inténtalo nuevamente.');
      }
    });
    contenedor.appendChild(item);
  });
}

export async function iniciarPlantillas(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const recargar = async () => {
    try {
      const plantillas = await obtenerPlantillas(supabase);
      $('#pl-cargando')?.setAttribute('hidden', '');
      renderLista(plantillas, supabase, recargar);
    } catch {
      mostrarError('No pudimos cargar las plantillas. Recarga la página o inténtalo más tarde.');
    }
  };

  await recargar();

  $('#pl-canal')?.addEventListener('change', actualizarVisibilidadAsunto);
  $('#pl-btn-cancelar')?.addEventListener('click', limpiarFormulario);

  $<HTMLFormElement>('#pl-form')!.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const id = $<HTMLInputElement>('#pl-id')!.value;
    const datos = {
      nombre: $<HTMLInputElement>('#pl-nombre')!.value.trim(),
      canal: $<HTMLSelectElement>('#pl-canal')!.value as CanalPlantilla,
      asunto: $<HTMLInputElement>('#pl-asunto')!.value.trim() || null,
      cuerpo: $<HTMLTextAreaElement>('#pl-cuerpo')!.value.trim(),
      activo: $<HTMLInputElement>('#pl-activo')!.checked,
    };
    try {
      if (id) await actualizarPlantilla(supabase, id, datos);
      else await crearPlantilla(supabase, datos);
      limpiarFormulario();
      await recargar();
    } catch {
      mostrarError('No pudimos guardar la plantilla. Inténtalo nuevamente.');
    }
  });
}
