// Secciones "Usuarios del CRM" (cargo) y "Pasarelas de pago" de /admin/configuracion.

import type { SupabaseClient } from '@supabase/supabase-js';
import { cambiarCargo, cambiarPasarela, obtenerConfigAdmin, type ConfigAdmin } from '../lib/crm/admin-config-api.ts';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CARGOS = ['Head Coach', 'Coach', 'Asistente'];
const NOMBRE_PASARELA: Record<string, string> = { MERCADOPAGO: 'Mercado Pago', FLOW: 'Flow', GETNET: 'Getnet' };

let supabase: SupabaseClient;
let estado: ConfigAdmin;

function avisar(clave: string, error: string | null): void {
  const ok = $<HTMLElement>(`[data-ok="${clave}"]`);
  const err = $<HTMLElement>(`[data-error="${clave}"]`);
  err.hidden = !error;
  err.textContent = error ?? '';
  ok.hidden = !!error;
  if (!error) setTimeout(() => (ok.hidden = true), 2500);
}

function render(): void {
  const editable = estado.esAdmin;
  $<HTMLElement>('#us-lista').innerHTML = estado.usuarios
    .map(
      (u) => `<tr>
        <td>${esc(u.display_name ?? '—')}${u.active ? '' : ' <span class="admin-badge admin-badge--estado-cerrado-no">Inactivo</span>'}</td>
        <td>${esc(u.nombre_firma ?? '—')}</td>
        <td>${esc(u.role)}</td>
        <td>${
          editable
            ? `<select class="admin-select" data-usuario="${esc(u.user_id)}" aria-label="Cargo de ${esc(u.display_name ?? '')}">${CARGOS.map(
                (c) => `<option ${c === u.cargo ? 'selected' : ''}>${c}</option>`,
              ).join('')}</select>`
            : esc(u.cargo)
        }</td></tr>`,
    )
    .join('');

  $<HTMLElement>('#ps-lista').innerHTML = estado.pasarelas
    .map((p) => {
      const badges = [
        p.habilitada ? '<span class="admin-badge admin-badge--estado-cerrado-ok">Habilitada</span>' : '<span class="admin-badge admin-badge--estado-cerrado-no">Deshabilitada</span>',
        p.preferida ? '<span class="admin-badge admin-badge--journey">Preferida</span>' : '',
        p.configurada ? '' : '<span class="admin-badge admin-badge--vencido">Sin credenciales</span>',
      ].join('');
      const acciones = editable
        ? [
            p.habilitada
              ? `<button type="button" class="admin-btn admin-btn--secundario" data-pasarela="${p.id}" data-cambio="deshabilitar">Deshabilitar</button>`
              : `<button type="button" class="admin-btn admin-btn--secundario" data-pasarela="${p.id}" data-cambio="habilitar" ${p.configurada ? '' : 'disabled'}>Habilitar</button>`,
            p.preferida ? '' : `<button type="button" class="admin-btn admin-btn--secundario" data-pasarela="${p.id}" data-cambio="preferir" ${p.configurada ? '' : 'disabled'}>Usar como preferida</button>`,
          ].join('')
        : '';
      return `<li class="ps-item"><div><p class="ps-item__nombre">${NOMBRE_PASARELA[p.id] ?? esc(p.id)}</p><div class="ps-item__estado">${badges}</div></div><div class="ps-item__acciones">${acciones}</div></li>`;
    })
    .join('');
}

export async function iniciarUsuariosYPasarelas(cliente: SupabaseClient): Promise<void> {
  supabase = cliente;
  try {
    estado = await obtenerConfigAdmin(supabase);
  } catch {
    return; // sin permisos o sin conexión: las secciones quedan ocultas
  }
  if (!estado.esAdmin) $<HTMLElement>('#us-ayuda').textContent = 'El cargo define cómo se presenta cada persona en los mensajes. Para cambiarlo, pídelo a un usuario con rol ADMIN.';
  render();

  $<HTMLElement>('#us-lista').addEventListener('change', async (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-usuario]');
    if (!sel) return;
    sel.disabled = true;
    try {
      estado = await cambiarCargo(supabase, sel.dataset.usuario!, sel.value);
      render();
      avisar('us', null);
    } catch (err) {
      avisar('us', err instanceof Error ? err.message : 'No se pudo cambiar el cargo.');
      sel.disabled = false;
    }
  });

  $<HTMLElement>('#ps-lista').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pasarela]');
    if (!b) return;
    const nombre = NOMBRE_PASARELA[b.dataset.pasarela!] ?? b.dataset.pasarela;
    const preguntas: Record<string, string> = {
      deshabilitar: `¿Deshabilitar ${nombre}? Los pagos nuevos del registro Star y de la campaña usarán otra pasarela habilitada.`,
      habilitar: `¿Habilitar ${nombre}?`,
      preferir: `¿Usar ${nombre} como pasarela preferida para los pagos nuevos del registro Star y la campaña?`,
    };
    if (!confirm(preguntas[b.dataset.cambio!])) return;
    b.disabled = true;
    try {
      estado = await cambiarPasarela(supabase, b.dataset.pasarela!, b.dataset.cambio as 'habilitar' | 'deshabilitar' | 'preferir');
      render();
      avisar('ps', null);
    } catch (err) {
      avisar('ps', err instanceof Error ? err.message : 'No se pudo cambiar la pasarela.');
      b.disabled = false;
    }
  });

  $<HTMLElement>('#us-seccion').hidden = false;
  $<HTMLElement>('#ps-seccion').hidden = false;
}
