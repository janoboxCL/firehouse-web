import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import { obtenerCasos, agruparClasePruebaPorFecha, actualizarCaso, type CasoResumen } from '../lib/crm/admin-api.ts';
import { etiquetaDia, type DiaClasePrueba } from '../lib/crm/clase-prueba.ts';
import { CRM_ESTADOS } from '../lib/crm/constants.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function mostrarError(mensaje: string): void {
  $('#cp-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#cp-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function tituloGrupo(fechaISO: string): string {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  const texto = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function filaCaso(caso: CasoResumen, supabase: SupabaseClient): HTMLElement {
  const fila = document.createElement('div');
  const yaAsistio = caso.estado === CRM_ESTADOS.ASISTIO;
  fila.className = `cp-fila${yaAsistio ? ' cp-fila--asistio' : ''}`;

  const info = document.createElement('div');
  info.className = 'cp-fila__info';
  const dia = caso.dia_clase_prueba ? etiquetaDia(caso.dia_clase_prueba as DiaClasePrueba) : '';
  info.innerHTML = `
    <p class="cp-fila__nombre">${caso.atleta.nombre} ${caso.atleta.apellidos}</p>
    <p class="cp-fila__detalle">${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos} · ${caso.atleta.apoderado.telefono}${dia ? ` · ${dia}` : ''}</p>
  `;

  const accion = document.createElement('div');
  accion.className = 'cp-fila__accion';

  if (yaAsistio) {
    accion.innerHTML = '<span class="cp-fila__confirmado">✓ Asistió</span>';
  } else {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'admin-btn admin-btn--whatsapp';
    boton.textContent = '✓ Marcar asistencia';
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        await actualizarCaso(supabase, caso.id, { estado: CRM_ESTADOS.ASISTIO });
        fila.classList.add('cp-fila--asistio');
        accion.innerHTML = '<span class="cp-fila__confirmado">✓ Asistió</span>';
      } catch {
        mostrarError('No pudimos marcar la asistencia. Inténtalo nuevamente.');
        boton.disabled = false;
      }
    });
    accion.appendChild(boton);
  }

  fila.append(info, accion);
  return fila;
}

export async function iniciarClasePrueba(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  let casos: CasoResumen[];
  try {
    casos = await obtenerCasos(supabase);
  } catch {
    mostrarError('No pudimos cargar la lista. Recarga la página o inténtalo más tarde.');
    return;
  }

  $('#cp-cargando')?.setAttribute('hidden', '');

  const grupos = agruparClasePruebaPorFecha(casos);
  if (grupos.length === 0) {
    $<HTMLElement>('#cp-vacio')!.hidden = false;
    return;
  }

  const contenedor = $<HTMLElement>('#cp-grupos')!;
  grupos.forEach((grupo) => {
    const seccion = document.createElement('div');
    seccion.className = 'cp-grupo';
    const titulo = document.createElement('p');
    titulo.className = 'cp-grupo__titulo';
    titulo.textContent = `${tituloGrupo(grupo.fecha)} · ${grupo.casos.length} confirmado${grupo.casos.length === 1 ? '' : 's'}`;
    seccion.appendChild(titulo);
    grupo.casos.forEach((c) => seccion.appendChild(filaCaso(c, supabase)));
    contenedor.appendChild(seccion);
  });
}
