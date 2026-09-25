import { escaparHtml } from '../lib/crm/format.ts';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerPlantillas,
  crearPlantilla,
  actualizarPlantilla,
  eliminarPlantilla,
  enviarCorreoAdmin,
  type PlantillaMensaje,
  type CanalPlantilla,
  type CategoriaPlantilla,
} from '../lib/crm/admin-api.ts';
import { obtenerFirma, obtenerValorInscripcionStar } from '../lib/crm/admin-mensajes-api.ts';
import { obtenerConfigAcademia } from '../lib/crm/admin-config-api.ts';
import { CONFIG_RESPALDO } from '../lib/crm/config-academia.ts';
import { getNextStarClassDate } from '../lib/crm/star-class.ts';
import { cargoEnMensaje, completarPlantilla, fechaClaseTexto, mensajeFaltantes, type DatosPlantillaMensaje } from '../lib/crm/plantillas.ts';
import { renderizarCorreo, type ClaseCorreo } from '../lib/crm/correo-plantilla.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

const CANAL_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Correo', AMBOS: 'WhatsApp y correo' };

/** Datos de ejemplo para la vista previa (se completan con tu firma y la configuración). */
const EJEMPLO: DatosPlantillaMensaje = {
  nombre_apoderado: 'Carla',
  nombre_atleta: 'Sofía',
  remitente: 'Benjamín',
  cargo: 'Head Coach',
  fecha_clase: 'el sábado 3 de octubre',
  hora_clase: '18:30',
  talla: 'M',
  valor_inscripcion: '$10.000',
  // Link de ejemplo: el real se genera para cada familia al enviar.
  link_pago: 'https://firehousecheer.cl/firehouse-star',
};
let CLASE_EJEMPLO: ClaseCorreo = { etiqueta: 'Tu primera clase', horaFin: '20:00' };

function mostrarError(mensaje: string): void {
  const el = $<HTMLElement>('#pl-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

function leerFormulario() {
  return {
    nombre: $<HTMLInputElement>('#pl-nombre')!.value.trim(),
    canal: $<HTMLSelectElement>('#pl-canal')!.value as CanalPlantilla,
    asunto: $<HTMLInputElement>('#pl-asunto')!.value.trim() || null,
    cuerpo: $<HTMLTextAreaElement>('#pl-cuerpo')!.value.trim(),
    cuerpo_email: $<HTMLTextAreaElement>('#pl-cuerpo-email')!.value.trim() || null,
    activo: $<HTMLInputElement>('#pl-activo')!.checked,
    categoria: $<HTMLSelectElement>('#pl-categoria')!.value as CategoriaPlantilla,
  };
}

function correoDelFormulario() {
  const f = leerFormulario();
  return renderizarCorreo({
    asunto: f.asunto || f.nombre || 'Firehouse Star',
    cuerpo: f.cuerpo_email || f.cuerpo,
    datos: EJEMPLO,
    clase: f.categoria === 'CLASE_PRUEBA' ? CLASE_EJEMPLO : undefined,
  });
}

function actualizarVistaPrevia(): void {
  const f = leerFormulario();
  const usaWa = f.canal !== 'EMAIL';
  const usaCorreo = f.canal !== 'WHATSAPP';
  $<HTMLElement>('#pl-previa-wa-wrap')!.hidden = !usaWa;
  $<HTMLElement>('#pl-previa-correo-wrap')!.hidden = !usaCorreo;

  const faltantes = new Set<string>();
  if (usaWa) {
    const wa = completarPlantilla(f.cuerpo, EJEMPLO);
    wa.faltantes.forEach((v) => faltantes.add(v));
    $<HTMLElement>('#pl-previa-wa')!.textContent = wa.texto;
  }
  if (usaCorreo) {
    const correo = correoDelFormulario();
    correo.faltantes.forEach((v) => faltantes.add(v));
    $<HTMLElement>('#pl-previa-asunto')!.textContent = correo.asunto;
    $<HTMLIFrameElement>('#pl-previa-correo')!.srcdoc = correo.html;
  }
  const aviso = $<HTMLElement>('#pl-previa-faltan')!;
  aviso.textContent = faltantes.size ? mensajeFaltantes([...faltantes] as never) : '';
  aviso.hidden = faltantes.size === 0;
}

function actualizarVisibilidadCanal(): void {
  const canal = $<HTMLSelectElement>('#pl-canal')!.value;
  $<HTMLElement>('#pl-asunto-wrap')!.hidden = canal === 'WHATSAPP';
  $<HTMLElement>('#pl-email-wrap')!.hidden = canal === 'WHATSAPP';
  $('#pl-cuerpo-label')!.textContent = canal === 'EMAIL' ? 'Mensaje (texto simple)' : 'Mensaje de WhatsApp';
  actualizarVistaPrevia();
}

function limpiarFormulario(): void {
  $<HTMLInputElement>('#pl-id')!.value = '';
  $<HTMLFormElement>('#pl-form')!.reset();
  $<HTMLInputElement>('#pl-activo')!.checked = true;
  actualizarVisibilidadCanal();
  $('#pl-form-titulo')!.textContent = 'Nueva plantilla';
  $<HTMLButtonElement>('#pl-btn-cancelar')!.hidden = true;
}

function cargarEnFormulario(p: PlantillaMensaje): void {
  $<HTMLInputElement>('#pl-id')!.value = p.id;
  $<HTMLInputElement>('#pl-nombre')!.value = p.nombre;
  $<HTMLSelectElement>('#pl-canal')!.value = p.canal;
  $<HTMLSelectElement>('#pl-categoria')!.value = p.categoria ?? 'GENERAL';
  $<HTMLInputElement>('#pl-asunto')!.value = p.asunto ?? '';
  $<HTMLTextAreaElement>('#pl-cuerpo')!.value = p.cuerpo;
  $<HTMLTextAreaElement>('#pl-cuerpo-email')!.value = p.cuerpo_email ?? '';
  $<HTMLInputElement>('#pl-activo')!.checked = p.activo;
  actualizarVisibilidadCanal();
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
    const conCorreo = p.canal !== 'WHATSAPP' && p.cuerpo_email;
    item.innerHTML = `
      <div>
        <p class="pl-item__nombre">${escaparHtml(p.nombre)} · <span class="admin-badge admin-badge--journey">${CANAL_LABEL[p.canal] ?? p.canal}</span>${
          p.categoria === 'CLASE_PRUEBA' ? ' <span class="admin-badge admin-badge--journey">Clase de prueba</span>' : ''
        }${conCorreo ? ' <span class="admin-badge admin-badge--journey">Correo con diseño</span>' : ''}${
          p.activo ? '' : ' <span class="admin-badge admin-badge--estado-cerrado-no">Inactiva</span>'
        }</p>
        <p class="pl-item__cuerpo">${escaparHtml(p.cuerpo)}</p>
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

/** Completa los datos de ejemplo con tu firma, la próxima clase Star y el valor vigente. */
async function prepararEjemplo(supabase: SupabaseClient): Promise<void> {
  const [firma, config, valor] = await Promise.all([
    obtenerFirma(supabase).catch(() => null),
    obtenerConfigAcademia(supabase).catch(() => null),
    obtenerValorInscripcionStar(supabase).catch(() => null),
  ]);
  const c = config?.config ?? CONFIG_RESPALDO;
  if (firma?.nombre) EJEMPLO.remitente = firma.nombre;
  if (firma?.cargo) EJEMPLO.cargo = cargoEnMensaje(firma.cargo);
  EJEMPLO.fecha_clase = fechaClaseTexto(getNextStarClassDate(new Date(), c.starPrimeraClase)) ?? EJEMPLO.fecha_clase;
  EJEMPLO.hora_clase = c.starHoraInicio;
  if (valor) EJEMPLO.valor_inscripcion = valor;
  CLASE_EJEMPLO = { etiqueta: 'Tu primera clase', horaFin: c.starHoraFin };
}

function conectarPrueba(supabase: SupabaseClient): void {
  const boton = $<HTMLButtonElement>('#pl-btn-prueba')!;
  const estado = $<HTMLElement>('#pl-prueba-estado')!;
  boton.addEventListener('click', async () => {
    estado.hidden = true;
    estado.classList.remove('pl-prueba-estado--error');
    const email = (await supabase.auth.getSession()).data.session?.user.email;
    if (!email) return;
    const correo = correoDelFormulario();
    boton.disabled = true;
    try {
      await enviarCorreoAdmin(supabase, email, `[Prueba] ${correo.asunto}`, correo.html, correo.texto);
      estado.textContent = `Enviado a ${email} ✓`;
    } catch (err) {
      estado.textContent = (err as Error).message || 'No pudimos enviar el correo de prueba.';
      estado.classList.add('pl-prueba-estado--error');
    } finally {
      estado.hidden = false;
      boton.disabled = false;
    }
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
      mostrarError('No pudimos cargar las plantillas. Si aún no ejecutas la migración 0012, ejecútala en Supabase.');
    }
  };

  await Promise.all([recargar(), prepararEjemplo(supabase)]);
  actualizarVisibilidadCanal();
  conectarPrueba(supabase);

  $('#pl-canal')?.addEventListener('change', actualizarVisibilidadCanal);
  ['#pl-nombre', '#pl-asunto', '#pl-cuerpo', '#pl-cuerpo-email'].forEach((s) => $(s)?.addEventListener('input', actualizarVistaPrevia));
  $('#pl-categoria')?.addEventListener('change', actualizarVistaPrevia);
  $('#pl-btn-cancelar')?.addEventListener('click', limpiarFormulario);

  $<HTMLFormElement>('#pl-form')!.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const id = $<HTMLInputElement>('#pl-id')!.value;
    const datos = leerFormulario();
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
