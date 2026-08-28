import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasoPorId,
  obtenerAdmins,
  obtenerInteracciones,
  actualizarCaso,
  agregarInteraccion,
  eliminarAtleta,
  eliminarApoderado,
  edadDeAtleta,
  casoSinProximaAccion,
  nombreAdminDe,
  type CasoResumen,
  type AdminMini,
  type Interaccion,
} from '../lib/crm/admin-api.ts';
import {
  CRM_JOURNEYS_LABEL,
  RELACION_APODERADO_LABEL,
  CANAL_PREFERIDO_LABEL,
  EXPERIENCIA_RANGOS_LABEL,
  INTERACCION_TIPOS_LABEL,
  INTERACCION_TIPOS,
  LIMITES,
} from '../lib/crm/constants.ts';
import { formatearFecha, formatearFechaHora, aFechaLocalInput, mensajeWhatsappSugerido } from '../lib/crm/format.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function dd(etiqueta: string, valor: string): string {
  return `<dt>${etiqueta}</dt><dd>${valor}</dd>`;
}

function leerIdDeUrl(): string | null {
  return new URLSearchParams(window.location.search).get('id');
}

function mostrarError(mensaje: string): void {
  $('#ficha-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#ficha-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function renderBloqueAtleta(caso: CasoResumen): void {
  const a = caso.atleta;
  const edad = edadDeAtleta(a);
  const experiencia =
    a.tiene_experiencia === null || a.tiene_experiencia === undefined
      ? '—'
      : a.tiene_experiencia
        ? 'Sí'
        : 'No';

  $('#bloque-atleta')!.innerHTML = [
    dd('Nombre completo', `${a.nombre} ${a.apellidos}`),
    dd('Edad', edad === null ? '—' : `${edad} años${a.fuera_rango_habitual ? ' (fuera del rango habitual)' : ''}`),
    dd('Fecha nacimiento', formatearFecha(a.fecha_nacimiento)),
    dd('Firehouse actual', a.firehouse_actual ? 'Sí' : 'No'),
    dd('Experiencia previa', a.firehouse_actual ? '—' : experiencia),
    dd('Tiempo de experiencia', a.anos_experiencia ? EXPERIENCIA_RANGOS_LABEL[a.anos_experiencia] ?? '—' : '—'),
    dd('Academia anterior', a.academia_anterior || '—'),
    dd('Journey', CRM_JOURNEYS_LABEL[caso.journey] ?? caso.journey),
  ].join('');
}

function renderBloqueApoderado(caso: CasoResumen): void {
  const ap = caso.atleta.apoderado;
  $('#bloque-apoderado')!.innerHTML = [
    dd('Nombre', `${ap.nombre} ${ap.apellidos}`),
    dd('Relación', RELACION_APODERADO_LABEL[ap.relacion] ?? ap.relacion),
    dd('WhatsApp', ap.telefono),
    dd('Email', ap.email),
    dd('Comuna', ap.comuna),
    dd('Canal preferido', CANAL_PREFERIDO_LABEL[ap.canal_preferido] ?? ap.canal_preferido),
  ].join('');

  const btnWa = $<HTMLAnchorElement>('#btn-whatsapp')!;
  const mensaje = mensajeWhatsappSugerido(caso.journey, caso.estado, ap.nombre, caso.atleta.nombre);
  btnWa.href = `https://wa.me/${ap.telefono.replace('+', '')}?text=${encodeURIComponent(mensaje)}`;
  const btnEmail = $<HTMLAnchorElement>('#btn-email')!;
  btnEmail.href = `mailto:${ap.email}`;

  $('#btn-copiar-telefono')?.addEventListener('click', async (evt) => {
    const boton = evt.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(ap.telefono);
    const original = boton.textContent;
    boton.textContent = 'Copiado ✓';
    setTimeout(() => (boton.textContent = original), 1500);
  });

  const duplicado = $<HTMLElement>('#ficha-duplicado')!;
  duplicado.hidden = !ap.possible_duplicate;
}

function poblarSelectResponsable(admins: AdminMini[], seleccionadoId: string | null): void {
  const select = $<HTMLSelectElement>('#g-responsable')!;
  admins.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.user_id;
    opt.textContent = a.display_name || a.role;
    select.appendChild(opt);
  });
  select.value = seleccionadoId ?? '';
}

function actualizarAvisoSinAccion(): void {
  const estado = $<HTMLSelectElement>('#g-estado')!.value;
  const proximaAccion = $<HTMLInputElement>('#g-proxima-accion')!.value;
  const aviso = $<HTMLElement>('#ficha-sin-accion')!;
  aviso.hidden = !casoSinProximaAccion({ estado, proxima_accion: proximaAccion || null });
}

function rellenarFormularioGestion(caso: CasoResumen): void {
  $<HTMLSelectElement>('#g-journey')!.value = caso.journey;
  $<HTMLSelectElement>('#g-estado')!.value = caso.estado;
  $<HTMLInputElement>('#g-proxima-accion')!.value = caso.proxima_accion ?? '';
  $<HTMLInputElement>('#g-fecha')!.value = aFechaLocalInput(caso.fecha_proxima_accion);
  $<HTMLSelectElement>('#g-prioridad')!.value = caso.prioridad;
  actualizarAvisoSinAccion();
}

function renderTimeline(interacciones: Interaccion[], admins: AdminMini[]): void {
  const lista = $<HTMLElement>('#ficha-timeline')!;
  lista.innerHTML = '';
  if (interacciones.length === 0) {
    lista.innerHTML = '<li class="admin-vacio">Todavía no hay interacciones registradas.</li>';
    return;
  }
  interacciones.forEach((i) => {
    const li = document.createElement('li');
    const meta = document.createElement('p');
    meta.className = 'ficha-timeline__meta';
    const responsable = i.responsable_id ? nombreAdminDe(admins, i.responsable_id) : 'Sistema';
    meta.textContent = `${formatearFechaHora(i.fecha)} — ${responsable}`;
    const tipo = document.createElement('p');
    tipo.className = 'ficha-timeline__tipo';
    tipo.textContent = INTERACCION_TIPOS_LABEL[i.tipo] ?? i.tipo;
    const nota = document.createElement('p');
    nota.textContent = i.nota ?? ''; // nunca innerHTML: el texto del usuario nunca se renderiza como HTML
    li.append(meta, tipo, nota);
    lista.appendChild(li);
  });
}

function conectarBotonesEliminar(supabase: SupabaseClient, caso: CasoResumen): void {
  const btnAtleta = $<HTMLButtonElement>('#btn-eliminar-atleta');
  const btnApoderado = $<HTMLButtonElement>('#btn-eliminar-apoderado');
  const nombreAtleta = `${caso.atleta.nombre} ${caso.atleta.apellidos}`;
  const nombreApoderado = `${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}`;

  btnAtleta?.addEventListener('click', async () => {
    const confirmado = window.confirm(
      `¿Eliminar a ${nombreAtleta} y su caso? Se borra también todo su historial de interacciones. Esta acción no se puede deshacer.`,
    );
    if (!confirmado) return;
    try {
      await eliminarAtleta(supabase, caso.atleta.id);
      window.location.href = '/admin';
    } catch {
      mostrarError('No pudimos eliminar el registro. Inténtalo nuevamente.');
    }
  });

  btnApoderado?.addEventListener('click', async () => {
    const confirmado = window.confirm(
      `¿Eliminar todo el registro de ${nombreApoderado}? Si tiene más de un/a atleta registrado/a, se eliminan todos junto con su historial. Esta acción no se puede deshacer.`,
    );
    if (!confirmado) return;
    try {
      await eliminarApoderado(supabase, caso.atleta.apoderado.id);
      window.location.href = '/admin';
    } catch {
      mostrarError('No pudimos eliminar el registro. Inténtalo nuevamente.');
    }
  });
}

export async function iniciarFicha(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const id = leerIdDeUrl();
  if (!id) {
    mostrarError('Falta el identificador del caso.');
    return;
  }

  let caso: CasoResumen | null;
  let admins: AdminMini[];
  let interacciones: Interaccion[];

  try {
    [caso, admins, interacciones] = await Promise.all([
      obtenerCasoPorId(supabase, id),
      obtenerAdmins(supabase),
      obtenerInteracciones(supabase, id),
    ]);
  } catch {
    mostrarError('No pudimos cargar este caso. Recarga la página o inténtalo más tarde.');
    return;
  }

  if (!caso) {
    mostrarError('No encontramos este caso.');
    return;
  }

  $('#ficha-cargando')?.setAttribute('hidden', '');
  $('#ficha-contenido')!.removeAttribute('hidden');

  renderBloqueAtleta(caso);
  renderBloqueApoderado(caso);
  poblarSelectResponsable(admins, caso.responsable_id);
  rellenarFormularioGestion(caso);
  renderTimeline(interacciones, admins);

  $('#g-estado')?.addEventListener('change', actualizarAvisoSinAccion);
  $('#g-proxima-accion')?.addEventListener('input', actualizarAvisoSinAccion);

  await conectarFormularioGestion(supabase, id, admins);
  conectarFormularioInteraccion(supabase, id, admins);
  conectarBotonesEliminar(supabase, caso);
}

async function recargarCasoYTimeline(
  supabase: SupabaseClient,
  id: string,
  admins: AdminMini[],
): Promise<void> {
  const [caso, interacciones] = await Promise.all([obtenerCasoPorId(supabase, id), obtenerInteracciones(supabase, id)]);
  if (!caso) return;
  renderBloqueAtleta(caso);
  rellenarFormularioGestion(caso);
  renderTimeline(interacciones, admins);
}

async function conectarFormularioGestion(supabase: SupabaseClient, id: string, admins: AdminMini[]): Promise<void> {
  const form = $<HTMLFormElement>('#form-gestion')!;
  const boton = $<HTMLButtonElement>('#btn-guardar-gestion')!;
  const guardado = $<HTMLElement>('#gestion-guardado')!;

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    boton.disabled = true;
    guardado.hidden = true;

    const fechaInput = $<HTMLInputElement>('#g-fecha')!.value;

    try {
      await actualizarCaso(supabase, id, {
        journey: $<HTMLSelectElement>('#g-journey')!.value,
        estado: $<HTMLSelectElement>('#g-estado')!.value,
        responsable_id: $<HTMLSelectElement>('#g-responsable')!.value || null,
        proxima_accion: $<HTMLInputElement>('#g-proxima-accion')!.value || null,
        fecha_proxima_accion: fechaInput ? new Date(fechaInput).toISOString() : null,
        prioridad: $<HTMLSelectElement>('#g-prioridad')!.value,
      });
      // Volvemos a leer el caso: si el nuevo estado es de cierre, un trigger en la base de
      // datos ya limpió próxima acción/fecha, y tanto el cambio de estado como el de
      // categoría ya quedaron registrados como interacción — reflejamos todo recargando.
      await recargarCasoYTimeline(supabase, id, admins);
      guardado.hidden = false;
      setTimeout(() => (guardado.hidden = true), 2500);
    } catch {
      mostrarError('No pudimos guardar los cambios. Inténtalo nuevamente.');
    } finally {
      boton.disabled = false;
    }
  });
}

function conectarFormularioInteraccion(supabase: SupabaseClient, id: string, admins: AdminMini[]): void {
  const form = $<HTMLFormElement>('#form-interaccion')!;
  const nota = $<HTMLTextAreaElement>('#i-nota')!;
  const contador = $<HTMLElement>('#i-contador')!;
  const boton = $<HTMLButtonElement>('#btn-agregar-interaccion')!;

  const actualizarContador = () => {
    contador.textContent = `${nota.value.length} / ${LIMITES.NOTA_INTERACCION_MAX}`;
  };
  nota.addEventListener('input', actualizarContador);
  actualizarContador();

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const texto = nota.value.trim();
    if (!texto) {
      nota.focus();
      return;
    }
    boton.disabled = true;
    try {
      const tipo = $<HTMLSelectElement>('#i-tipo')!.value || INTERACCION_TIPOS.NOTA;
      await agregarInteraccion(supabase, id, tipo, texto);
      nota.value = '';
      actualizarContador();
      const interacciones = await obtenerInteracciones(supabase, id);
      renderTimeline(interacciones, admins);
    } catch {
      mostrarError('No pudimos guardar la interacción. Inténtalo nuevamente.');
    } finally {
      boton.disabled = false;
    }
  });
}
