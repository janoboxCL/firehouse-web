import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  obtenerAdmins,
  obtenerNotasApoderado,
  agregarNotaApoderado,
  obtenerPlantillas,
  enviarCorreoAdmin,
  eliminarApoderado,
  edadDeAtleta,
  nombreAdminDe,
  ordenarCasos,
  type CasoResumen,
  type AdminMini,
  type NotaApoderado,
  type PlantillaMensaje,
} from '../lib/crm/admin-api.ts';
import { CRM_JOURNEYS_LABEL, CRM_ESTADOS_LABEL, RELACION_APODERADO_LABEL, CANAL_PREFERIDO_LABEL } from '../lib/crm/constants.ts';
import { formatearFecha, formatearFechaHora, claseBadgeEstado, mensajeWhatsappSugerido, mensajeErrorSupabase } from '../lib/crm/format.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerFirma, type Firma } from '../lib/crm/admin-mensajes-api.ts';
import { iniciarCuentaFamilia } from './admin-cuenta.ts';
import { cargoEnMensaje, completarPlantilla, enlaceWhatsApp, mensajeFaltantes, primerNombre } from '../lib/crm/plantillas.ts';
import { renderizarCorreo } from '../lib/crm/correo-plantilla.ts';

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
  $('#ap-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#ap-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function nombresAtletas(casos: CasoResumen[]): string {
  const nombres = casos.map((c) => c.atleta.nombre);
  if (nombres.length === 1) return nombres[0];
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

function renderDatosApoderado(casos: CasoResumen[]): void {
  const ap = casos[0].atleta.apoderado;
  $('#ap-datos')!.innerHTML = [
    dd('Nombre', `${ap.nombre} ${ap.apellidos}`),
    dd('Relación', RELACION_APODERADO_LABEL[ap.relacion] ?? ap.relacion),
    dd('WhatsApp', ap.telefono),
    dd('Email', ap.email),
    dd('Comuna', ap.comuna),
    dd('Canal preferido', CANAL_PREFERIDO_LABEL[ap.canal_preferido] ?? ap.canal_preferido),
  ].join('');

  const btnWa = $<HTMLAnchorElement>('#ap-btn-whatsapp')!;
  const casoMasUrgente = ordenarCasos(casos)[0];
  const mensaje = mensajeWhatsappSugerido(casoMasUrgente.journey, casoMasUrgente.estado, ap.nombre, nombresAtletas(casos));
  btnWa.href = `https://wa.me/${ap.telefono.replace('+', '')}?text=${encodeURIComponent(mensaje)}`;

  $<HTMLAnchorElement>('#ap-btn-email')!.href = `mailto:${ap.email}`;

  $('#ap-btn-copiar')?.addEventListener('click', async (evt) => {
    const boton = evt.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(ap.telefono);
    const original = boton.textContent;
    boton.textContent = 'Copiado ✓';
    setTimeout(() => (boton.textContent = original), 1500);
  });

  $<HTMLElement>('#ap-duplicado')!.hidden = !ap.possible_duplicate;
}

function renderAtletas(casos: CasoResumen[], admins: AdminMini[]): void {
  const cuerpo = $<HTMLElement>('#ap-atletas-body')!;
  cuerpo.innerHTML = '';
  ordenarCasos(casos).forEach((c) => {
    const tr = document.createElement('tr');
    const edad = edadDeAtleta(c.atleta);
    tr.addEventListener('click', () => (window.location.href = `/admin/caso?id=${c.id}`));
    tr.innerHTML = `
      <td>${c.atleta.nombre} ${c.atleta.apellidos}${edad !== null ? ` (${edad})` : ''}</td>
      <td><span class="admin-badge admin-badge--journey">${CRM_JOURNEYS_LABEL[c.journey] ?? c.journey}</span></td>
      <td><span class="admin-badge ${claseBadgeEstado(c.estado)}">${CRM_ESTADOS_LABEL[c.estado] ?? c.estado}</span></td>
      <td>${c.proxima_accion ?? '—'}</td>
      <td>${formatearFecha(c.fecha_proxima_accion)}</td>
      <td>${nombreAdminDe(admins, c.responsable_id)}</td>
    `;
    cuerpo.appendChild(tr);
  });
}

function renderNotas(notas: NotaApoderado[], admins: AdminMini[]): void {
  const lista = $<HTMLElement>('#ap-notas')!;
  lista.innerHTML = '';
  if (notas.length === 0) {
    lista.innerHTML = '<li class="admin-vacio">Todavía no hay notas de familia.</li>';
    return;
  }
  notas.forEach((n) => {
    const li = document.createElement('li');
    const meta = document.createElement('p');
    meta.className = 'ficha-timeline__meta';
    meta.textContent = `${formatearFechaHora(n.created_at)} — ${nombreAdminDe(admins, n.responsable_id)}`;
    const texto = document.createElement('p');
    texto.textContent = n.nota; // nunca innerHTML: texto de usuario, nunca como HTML
    li.append(meta, texto);
    lista.appendChild(li);
  });
}

function poblarPlantillas(plantillas: PlantillaMensaje[]): void {
  const select = $<HTMLSelectElement>('#ap-select-plantilla')!;
  plantillas.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nombre;
    select.appendChild(opt);
  });
}

function datosFicha(nombreCompleto: string, atletas: string, firma: Firma) {
  return {
    nombre_apoderado: primerNombre(nombreCompleto),
    nombre_atleta: atletas,
    remitente: firma.nombre,
    cargo: cargoEnMensaje(firma.cargo),
  };
}

function textoPlantilla(plantilla: PlantillaMensaje, nombreCompleto: string, atletas: string, firma: Firma): { texto: string; faltantes: string } {
  const { texto, faltantes } = completarPlantilla(plantilla.cuerpo, datosFicha(nombreCompleto, atletas, firma));
  return { texto, faltantes: mensajeFaltantes(faltantes) };
}

function conectarPlantillas(supabase: SupabaseClient, casos: CasoResumen[], plantillas: PlantillaMensaje[]): void {
  let firma: Firma = { nombre: null, cargo: null, nombreFirma: null, disponible: false };
  void obtenerFirma(supabase).then((f) => (firma = f));
  const select = $<HTMLSelectElement>('#ap-select-plantilla')!;
  const btnWa = $<HTMLButtonElement>('#ap-btn-plantilla-whatsapp')!;
  const btnEmail = $<HTMLButtonElement>('#ap-btn-plantilla-email')!;
  const estado = $<HTMLElement>('#ap-plantilla-estado')!;
  const ap = casos[0].atleta.apoderado;
  const nombreCompleto = `${ap.nombre} ${ap.apellidos}`;
  const atletas = nombresAtletas(casos);

  select.addEventListener('change', () => {
    const plantilla = plantillas.find((p) => p.id === select.value);
    btnWa.disabled = !plantilla || (plantilla.canal !== 'WHATSAPP' && plantilla.canal !== 'AMBOS');
    btnEmail.disabled = !plantilla || (plantilla.canal !== 'EMAIL' && plantilla.canal !== 'AMBOS');
    estado.hidden = true;
  });

  btnWa.addEventListener('click', () => {
    const plantilla = plantillas.find((p) => p.id === select.value);
    if (!plantilla) return;
    const { texto, faltantes } = textoPlantilla(plantilla, nombreCompleto, atletas, firma);
    if (faltantes) {
      mostrarError(faltantes);
      return;
    }
    window.open(enlaceWhatsApp(ap.telefono, texto), '_blank', 'noopener');
  });

  btnEmail.addEventListener('click', async () => {
    const plantilla = plantillas.find((p) => p.id === select.value);
    if (!plantilla) return;
    btnEmail.disabled = true;
    estado.hidden = true;
    try {
      // Mismo diseño que los correos de clase de prueba (sin tarjeta de clase).
      const correo = renderizarCorreo({
        asunto: plantilla.asunto || plantilla.nombre,
        cuerpo: plantilla.cuerpo_email?.trim() || plantilla.cuerpo,
        datos: datosFicha(nombreCompleto, atletas, firma),
      });
      if (correo.faltantes.length) throw new Error(mensajeFaltantes(correo.faltantes));
      if (!window.confirm(`¿Enviar "${correo.asunto}" a ${ap.email}?`)) return;
      await enviarCorreoAdmin(supabase, ap.email, correo.asunto, correo.html, correo.texto);
      estado.textContent = 'Correo enviado ✓';
      estado.hidden = false;
    } catch (err) {
      mostrarError((err as Error).message || 'No pudimos enviar el correo.');
    } finally {
      btnEmail.disabled = false;
    }
  });
}

function conectarNotas(supabase: SupabaseClient, apoderadoId: string, admins: AdminMini[]): void {
  const form = $<HTMLFormElement>('#ap-form-nota')!;
  const textarea = $<HTMLTextAreaElement>('#ap-nota-texto')!;

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const texto = textarea.value.trim();
    if (!texto) return;
    try {
      await agregarNotaApoderado(supabase, apoderadoId, texto);
      textarea.value = '';
      const notas = await obtenerNotasApoderado(supabase, apoderadoId);
      renderNotas(notas, admins);
    } catch {
      mostrarError('No pudimos guardar la nota. Inténtalo nuevamente.');
    }
  });
}

function conectarEliminar(supabase: SupabaseClient, apoderadoId: string, nombreCompleto: string): void {
  $('#ap-btn-eliminar')?.addEventListener('click', async () => {
    const confirmado = window.confirm(
      `¿Eliminar todo el registro de ${nombreCompleto}? Se eliminan también todos sus atletas, casos e historial. Esta acción no se puede deshacer.`,
    );
    if (!confirmado) return;
    try {
      await eliminarApoderado(supabase, apoderadoId);
      window.location.href = '/admin';
    } catch (err) {
      mostrarError(mensajeErrorSupabase(err, 'No pudimos eliminar el registro. Inténtalo nuevamente.'));
    }
  });
}

export async function iniciarFichaApoderado(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const apoderadoId = leerIdDeUrl();
  if (!apoderadoId) {
    mostrarError('Falta el identificador del apoderado.');
    return;
  }

  let todosCasos: CasoResumen[];
  let admins: AdminMini[];
  let notas: NotaApoderado[];
  let plantillas: PlantillaMensaje[];

  try {
    [todosCasos, admins, notas, plantillas] = await Promise.all([
      obtenerCasos(supabase),
      obtenerAdmins(supabase),
      obtenerNotasApoderado(supabase, apoderadoId),
      obtenerPlantillas(supabase, true),
    ]);
    // En la ficha solo se usan las plantillas generales.
    plantillas = plantillas.filter((p) => (p.categoria ?? 'GENERAL') === 'GENERAL');
  } catch {
    mostrarError('No pudimos cargar este contacto. Recarga la página o inténtalo más tarde.');
    return;
  }

  const casos = todosCasos.filter((c) => c.atleta.apoderado.id === apoderadoId);
  if (casos.length === 0) {
    mostrarError('No encontramos este apoderado (puede que ya no tenga atletas asociados).');
    return;
  }

  $('#ap-cargando')?.setAttribute('hidden', '');
  $('#ap-contenido')!.removeAttribute('hidden');

  renderDatosApoderado(casos);
  renderAtletas(casos, admins);
  renderNotas(notas, admins);
  poblarPlantillas(plantillas);
  conectarPlantillas(supabase, casos, plantillas);
  conectarNotas(supabase, apoderadoId, admins);
  void iniciarCuentaFamilia(supabase, apoderadoId, casos[0].atleta.apoderado.telefono, casos[0].atleta.apoderado.nombre);
  conectarEliminar(supabase, apoderadoId, `${casos[0].atleta.apoderado.nombre} ${casos[0].atleta.apoderado.apellidos}`);
}
