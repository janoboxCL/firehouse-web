import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  agruparClasePruebaPorFecha,
  actualizarCaso,
  registrarVisitaRapida,
  validarDatosVisitaRapida,
  type CasoResumen,
} from '../lib/crm/admin-api.ts';
import { etiquetaDia, type DiaClasePrueba } from '../lib/crm/clase-prueba.ts';
import { CRM_ESTADOS } from '../lib/crm/constants.ts';
import { mensajeErrorSupabase } from '../lib/crm/format.ts';
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
      } catch (err) {
        mostrarError(mensajeErrorSupabase(err, 'No pudimos marcar la asistencia. Inténtalo nuevamente.'));
        boton.disabled = false;
      }
    });
    accion.appendChild(boton);
  }

  fila.append(info, accion);
  return fila;
}

async function renderizarLista(supabase: SupabaseClient): Promise<void> {
  let casos: CasoResumen[];
  try {
    casos = await obtenerCasos(supabase);
  } catch (err) {
    mostrarError(mensajeErrorSupabase(err, 'No pudimos cargar la lista. Recarga la página o inténtalo más tarde.'));
    return;
  }

  $('#cp-cargando')?.setAttribute('hidden', '');
  const vacio = $<HTMLElement>('#cp-vacio')!;
  const contenedor = $<HTMLElement>('#cp-grupos')!;
  contenedor.innerHTML = '';

  const grupos = agruparClasePruebaPorFecha(casos);
  if (grupos.length === 0) {
    vacio.hidden = false;
    return;
  }
  vacio.hidden = true;

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

function limpiarFormularioVisita(): void {
  $<HTMLFormElement>('#cp-form-visita')?.reset();
}

function conectarVisitaRapida(supabase: SupabaseClient): void {
  const wrap = $<HTMLElement>('#cp-visita-form-wrap')!;
  const btnAbrir = $<HTMLButtonElement>('#cp-btn-visita-rapida')!;
  const btnCancelar = $<HTMLButtonElement>('#cp-btn-cancelar-visita')!;
  const form = $<HTMLFormElement>('#cp-form-visita')!;
  const guardado = $<HTMLElement>('#cp-visita-guardada')!;

  btnAbrir.addEventListener('click', () => {
    wrap.hidden = !wrap.hidden;
  });
  btnCancelar.addEventListener('click', () => {
    wrap.hidden = true;
    limpiarFormularioVisita();
  });

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    guardado.hidden = true;

    const datos = {
      atletaNombre: $<HTMLInputElement>('#vr-atleta-nombre')!.value,
      atletaApellidos: $<HTMLInputElement>('#vr-atleta-apellidos')!.value,
      atletaEdadAproximada: Number($<HTMLInputElement>('#vr-atleta-edad')!.value) || null,
      apoderadoNombre: $<HTMLInputElement>('#vr-apoderado-nombre')!.value,
      apoderadoApellidos: $<HTMLInputElement>('#vr-apoderado-apellidos')!.value,
      apoderadoTelefono: $<HTMLInputElement>('#vr-telefono')!.value,
      apoderadoEmail: $<HTMLInputElement>('#vr-email')!.value,
    };

    const errores = validarDatosVisitaRapida(datos);
    if (errores.length > 0) {
      mostrarError(errores.join(' '));
      return;
    }
    $<HTMLElement>('#cp-error')!.hidden = true;

    const boton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    boton.disabled = true;
    try {
      const resultado = await registrarVisitaRapida(supabase, datos);
      limpiarFormularioVisita();
      wrap.hidden = true;
      guardado.textContent = resultado.possibleDuplicate
        ? 'Visita registrada — ojo, puede ser un contacto duplicado (revisa en Contactos).'
        : 'Visita registrada y marcada como asistió.';
      guardado.hidden = false;
      await renderizarLista(supabase);
    } catch (err) {
      mostrarError(mensajeErrorSupabase(err, 'No pudimos registrar la visita. Inténtalo nuevamente.'));
    } finally {
      boton.disabled = false;
    }
  });
}

export async function iniciarClasePrueba(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  conectarVisitaRapida(supabase);
  await renderizarLista(supabase);
}
