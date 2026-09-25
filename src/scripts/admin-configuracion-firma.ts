// Sección "Tu firma en los mensajes" de /admin/configuracion (migración 0009).

import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarNombreFirma, obtenerFirma } from '../lib/crm/admin-mensajes-api.ts';
import { mensajeErrorSupabase } from '../lib/crm/format.ts';
import { cargoEnMensaje } from '../lib/crm/plantillas.ts';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

function vistaPrevia(nombre: string, cargo: string): string {
  return `Hola, soy ${nombre || '…'}, ${cargoEnMensaje(cargo) ?? cargo} de Firehouse Star.`;
}

export async function iniciarFirma(supabase: SupabaseClient): Promise<void> {
  const firma = await obtenerFirma(supabase);
  if (!firma.disponible) return; // sin migración 0009 la sección no se muestra

  const input = $<HTMLInputElement>('#fm-nombre');
  const cargo = firma.cargo ?? 'Asistente';
  input.value = firma.nombreFirma ?? '';
  input.placeholder = firma.nombre ?? 'Ej.: Alejandro';
  $<HTMLElement>('#fm-cargo').textContent = cargo;
  const actualizar = () => ($<HTMLElement>('#fm-vista').textContent = vistaPrevia(input.value.trim() || firma.nombre || '', cargo));
  actualizar();
  input.addEventListener('input', actualizar);

  $<HTMLFormElement>('#fm-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const error = $<HTMLElement>('#fm-error');
    const guardado = $<HTMLElement>('#fm-guardado');
    error.hidden = true;
    guardado.hidden = true;
    try {
      await guardarNombreFirma(supabase, input.value);
      guardado.hidden = false;
      setTimeout(() => (guardado.hidden = true), 2500);
    } catch (err) {
      error.textContent = mensajeErrorSupabase(err, 'No pudimos guardar tu firma.');
      error.hidden = false;
    }
  });

  $<HTMLElement>('#fm-seccion').hidden = false;
}
