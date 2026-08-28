import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerApoderados,
  eliminarApoderado,
  fusionarApoderados,
  type ApoderadoConAtletas,
} from '../lib/crm/admin-api.ts';
import { RELACION_APODERADO_LABEL } from '../lib/crm/constants.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}
function $all<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

let TODOS: ApoderadoConAtletas[] = [];
const seleccionados = new Set<string>();

function nombresAtletas(ap: ApoderadoConAtletas): string {
  if (ap.atletas.length === 0) return '—';
  return ap.atletas.map((a) => `${a.nombre} ${a.apellidos}`).join(', ');
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

function coincide(ap: ApoderadoConAtletas, textoCrudo: string): boolean {
  const texto = textoCrudo.trim().toLowerCase();
  if (!texto) return true;
  return [ap.nombre, ap.apellidos, ap.telefono, ap.email].some((c) => c?.toLowerCase().includes(texto));
}

function actualizarBarraSeleccion(): void {
  const barra = $<HTMLElement>('#apoderados-barra')!;
  const contador = $<HTMLElement>('#apoderados-contador')!;
  const btn = $<HTMLButtonElement>('#btn-fusionar')!;

  barra.hidden = seleccionados.size === 0;
  contador.textContent = `${seleccionados.size} seleccionado${seleccionados.size === 1 ? '' : 's'} (máximo 2)`;
  btn.disabled = seleccionados.size !== 2;

  // Una vez hay 2 seleccionados, el resto de los checkboxes se deshabilita hasta
  // que se destilde alguno — evita que alguien seleccione un tercero por error.
  $all<HTMLInputElement>('[data-ap-checkbox]').forEach((cb) => {
    if (seleccionados.size >= 2 && !seleccionados.has(cb.dataset.apCheckbox!)) {
      cb.disabled = true;
    } else {
      cb.disabled = false;
    }
  });
}

function filaApoderado(ap: ApoderadoConAtletas, supabase: SupabaseClient, onCambio: () => void): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (ap.possible_duplicate) tr.classList.add('apoderados-fila-dup');

  tr.innerHTML = `
    <td><input type="checkbox" data-ap-checkbox="${ap.id}" /></td>
    <td>${ap.nombre} ${ap.apellidos}${ap.possible_duplicate ? ' <span class="admin-badge admin-badge--vencido">Posible duplicado</span>' : ''}</td>
    <td>${ap.telefono}</td>
    <td>${ap.email}</td>
    <td>${ap.comuna}</td>
    <td>${nombresAtletas(ap)}</td>
    <td></td>
  `;

  const checkbox = tr.querySelector<HTMLInputElement>('[data-ap-checkbox]')!;
  checkbox.checked = seleccionados.has(ap.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) seleccionados.add(ap.id);
    else seleccionados.delete(ap.id);
    actualizarBarraSeleccion();
  });

  const celdaAccion = tr.children[6];
  const btnEliminar = document.createElement('button');
  btnEliminar.type = 'button';
  btnEliminar.className = 'apoderados-eliminar-fila';
  btnEliminar.textContent = 'Eliminar';
  btnEliminar.addEventListener('click', async () => {
    const confirmado = window.confirm(
      `¿Eliminar todo el registro de ${ap.nombre} ${ap.apellidos}? Se eliminan también sus ${ap.atletas.length} atleta(s) registrados. Esta acción no se puede deshacer.`,
    );
    if (!confirmado) return;
    try {
      await eliminarApoderado(supabase, ap.id);
      seleccionados.delete(ap.id);
      onCambio();
    } catch {
      mostrarError('No pudimos eliminar el contacto. Inténtalo nuevamente.');
    }
  });
  celdaAccion.appendChild(btnEliminar);

  return tr;
}

function renderizar(supabase: SupabaseClient, onCambio: () => void): void {
  const texto = $<HTMLInputElement>('#ap-busqueda')?.value ?? '';
  const filtrados = TODOS.filter((ap) => coincide(ap, texto));

  const tabla = $<HTMLTableElement>('#apoderados-tabla')!;
  const vacio = $<HTMLElement>('#apoderados-vacio')!;
  const cuerpo = $<HTMLElement>('#apoderados-tabla-body')!;
  cuerpo.innerHTML = '';

  if (filtrados.length === 0) {
    tabla.hidden = true;
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  tabla.hidden = false;
  const frag = document.createDocumentFragment();
  filtrados.forEach((ap) => frag.appendChild(filaApoderado(ap, supabase, onCambio)));
  cuerpo.appendChild(frag);
  actualizarBarraSeleccion();
}

function mostrarError(mensaje: string): void {
  const el = $<HTMLElement>('#apoderados-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function tarjetaFusionOpcion(ap: ApoderadoConAtletas): string {
  return `
    <button type="button" class="fusion-opcion" data-mantener="${ap.id}">
      <p class="fusion-opcion__nombre">${ap.nombre} ${ap.apellidos}</p>
      <p class="fusion-opcion__dato">${ap.telefono}</p>
      <p class="fusion-opcion__dato">${ap.email}</p>
      <p class="fusion-opcion__dato">${ap.comuna} · ${RELACION_APODERADO_LABEL[ap.relacion] ?? ap.relacion}</p>
      <p class="fusion-opcion__dato">Atletas: ${nombresAtletas(ap)}</p>
      <p class="fusion-opcion__dato"><strong>Mantener este</strong></p>
    </button>`;
}

function abrirPanelFusion(supabase: SupabaseClient, onListo: () => void): void {
  const [idA, idB] = Array.from(seleccionados);
  const apA = TODOS.find((a) => a.id === idA);
  const apB = TODOS.find((a) => a.id === idB);
  if (!apA || !apB) return;

  const panel = $<HTMLElement>('#fusion-panel')!;
  const opciones = $<HTMLElement>('#fusion-panel__opciones')!;
  opciones.innerHTML = tarjetaFusionOpcion(apA) + tarjetaFusionOpcion(apB);
  panel.hidden = false;

  $all<HTMLButtonElement>('[data-mantener]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mantenerId = btn.dataset.mantener!;
      const descartarId = mantenerId === apA.id ? apB.id : apA.id;
      btn.disabled = true;
      try {
        await fusionarApoderados(supabase, mantenerId, descartarId);
        panel.hidden = true;
        seleccionados.clear();
        onListo();
      } catch {
        mostrarError('No pudimos fusionar estos contactos. Inténtalo nuevamente.');
        panel.hidden = true;
      }
    });
  });

  $<HTMLButtonElement>('#btn-cancelar-fusion')!.onclick = () => {
    panel.hidden = true;
  };
}

export async function iniciarApoderados(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const recargar = async () => {
    try {
      TODOS = await obtenerApoderados(supabase);
    } catch {
      mostrarError('No pudimos cargar los contactos. Recarga la página o inténtalo más tarde.');
      return;
    }
    $('#apoderados-cargando')?.setAttribute('hidden', '');
    renderizar(supabase, recargar);
  };

  await recargar();

  $('#ap-busqueda')?.addEventListener('input', debounce(() => renderizar(supabase, recargar), 200));
  $('#btn-fusionar')?.addEventListener('click', () => abrirPanelFusion(supabase, recargar));
}
