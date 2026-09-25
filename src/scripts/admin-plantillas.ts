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
import {
  cargoEnMensaje,
  completarPlantilla,
  fechaClaseTexto,
  mensajeFaltantes,
  type DatosPlantillaMensaje,
  type VariablePlantilla,
} from '../lib/crm/plantillas.ts';
import { renderizarCorreo, type ClaseCorreo, type CorreoRenderizado } from '../lib/crm/correo-plantilla.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

const CANAL_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Correo', AMBOS: 'WhatsApp y correo' };

type Filtro = 'EMAIL' | 'WHATSAPP' | 'TODAS';
const AYUDA_FILTRO: Record<Filtro, string> = {
  EMAIL:
    'Plantillas que se pueden enviar por correo. Las marcadas "WhatsApp y correo" son homólogas: el mismo mensaje con su versión para cada canal.',
  WHATSAPP: 'Plantillas que se pueden enviar por WhatsApp.',
  TODAS: 'Todas las plantillas, activas e inactivas.',
};

/** Lo necesario para previsualizar: una plantilla guardada o lo que está en el formulario. */
type ContenidoPlantilla = Pick<PlantillaMensaje, 'nombre' | 'canal' | 'asunto' | 'cuerpo' | 'cuerpo_email' | 'categoria'>;

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

let PLANTILLAS: PlantillaMensaje[] = [];
let FILTRO: Filtro = 'EMAIL';

const sirveCorreo = (p: { canal: string }) => p.canal !== 'WHATSAPP';
const sirveWhatsApp = (p: { canal: string }) => p.canal !== 'EMAIL';

function mostrarError(mensaje: string): void {
  const el = $<HTMLElement>('#pl-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Vista previa (compartida por el formulario y el diálogo)

interface Previa {
  wa: string | null;
  correo: CorreoRenderizado | null;
  faltantes: VariablePlantilla[];
}

function armarPrevia(p: ContenidoPlantilla): Previa {
  const faltantes = new Set<VariablePlantilla>();
  let wa: string | null = null;
  let correo: CorreoRenderizado | null = null;
  if (sirveWhatsApp(p)) {
    const r = completarPlantilla(p.cuerpo, EJEMPLO);
    r.faltantes.forEach((v) => faltantes.add(v));
    wa = r.texto;
  }
  if (sirveCorreo(p)) {
    correo = renderizarCorreo({
      asunto: p.asunto?.trim() || p.nombre || 'Firehouse Star',
      cuerpo: p.cuerpo_email?.trim() || p.cuerpo,
      datos: EJEMPLO,
      clase: p.categoria === 'CLASE_PRUEBA' ? CLASE_EJEMPLO : undefined,
    });
    correo.faltantes.forEach((v) => faltantes.add(v));
  }
  return { wa, correo, faltantes: [...faltantes] };
}

/** Pinta una vista previa en los elementos con el prefijo dado (#pl-previa-… o #pl-dialogo-…). */
function pintarPrevia(prefijo: string, previa: Previa): void {
  $<HTMLElement>(`#${prefijo}-wa-wrap`)!.hidden = previa.wa === null;
  $<HTMLElement>(`#${prefijo}-correo-wrap`)!.hidden = previa.correo === null;
  if (previa.wa !== null) $<HTMLElement>(`#${prefijo}-wa`)!.textContent = previa.wa;
  if (previa.correo) {
    $<HTMLElement>(`#${prefijo}-asunto`)!.textContent = previa.correo.asunto;
    $<HTMLIFrameElement>(`#${prefijo}-correo`)!.srcdoc = previa.correo.html;
  }
  const aviso = $<HTMLElement>(`#${prefijo}-faltan`)!;
  aviso.textContent = mensajeFaltantes(previa.faltantes);
  aviso.hidden = previa.faltantes.length === 0;
}

async function enviarPrueba(supabase: SupabaseClient, correo: CorreoRenderizado, estado: HTMLElement, boton: HTMLButtonElement) {
  estado.hidden = true;
  estado.classList.remove('pl-prueba-estado--error');
  const email = (await supabase.auth.getSession()).data.session?.user.email;
  if (!email) return;
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
}

// ---------------------------------------------------------------------------
// Formulario

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

function actualizarVistaPrevia(): void {
  pintarPrevia('pl-previa', armarPrevia(leerFormulario()));
}

function actualizarVisibilidadCanal(): void {
  const canal = $<HTMLSelectElement>('#pl-canal')!.value;
  $<HTMLElement>('#pl-asunto-wrap')!.hidden = canal === 'WHATSAPP';
  $<HTMLElement>('#pl-email-wrap')!.hidden = canal === 'WHATSAPP';
  $('#pl-cuerpo-label')!.textContent = canal === 'EMAIL' ? 'Mensaje (texto simple)' : 'Mensaje de WhatsApp';
  actualizarVistaPrevia();
}

function irAlFormulario(): void {
  $<HTMLElement>('.pl-form-card')!.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  irAlFormulario();
}

// ---------------------------------------------------------------------------
// Diálogo de vista previa

let PLANTILLA_EN_DIALOGO: PlantillaMensaje | null = null;

function abrirPrevia(p: PlantillaMensaje): void {
  PLANTILLA_EN_DIALOGO = p;
  $('#pl-dialogo-titulo')!.textContent = p.nombre;
  pintarPrevia('pl-dialogo', armarPrevia(p));
  $<HTMLButtonElement>('#pl-dialogo-prueba')!.hidden = !sirveCorreo(p);
  $<HTMLElement>('#pl-dialogo-estado')!.hidden = true;
  $<HTMLDialogElement>('#pl-dialogo')!.showModal();
}

function conectarDialogo(supabase: SupabaseClient): void {
  const dialogo = $<HTMLDialogElement>('#pl-dialogo')!;
  $('#pl-dialogo-cerrar')!.addEventListener('click', () => dialogo.close());
  // Clic fuera del contenido (en el fondo) también cierra.
  dialogo.addEventListener('click', (e) => {
    const r = dialogo.getBoundingClientRect();
    const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (e.target === dialogo && fuera) dialogo.close();
  });
  $('#pl-dialogo-editar')!.addEventListener('click', () => {
    if (!PLANTILLA_EN_DIALOGO) return;
    dialogo.close();
    cargarEnFormulario(PLANTILLA_EN_DIALOGO);
  });
  const boton = $<HTMLButtonElement>('#pl-dialogo-prueba')!;
  boton.addEventListener('click', () => {
    if (!PLANTILLA_EN_DIALOGO) return;
    const { correo } = armarPrevia(PLANTILLA_EN_DIALOGO);
    if (correo) void enviarPrueba(supabase, correo, $<HTMLElement>('#pl-dialogo-estado')!, boton);
  });
}

// ---------------------------------------------------------------------------
// Listado

/** Primeras líneas del correo, sin las marcas de formato. */
function extractoCorreo(texto: string): string {
  const limpio = texto
    .split('\n')
    .filter((l) => !/^\s*\[\[.*\]\]\s*$/.test(l))
    .map((l) => l.replace(/^\s*[-•]\s+/, '· '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > 180 ? `${limpio.slice(0, 180)}…` : limpio;
}

function coincideFiltro(p: PlantillaMensaje, filtro: Filtro): boolean {
  if (filtro === 'EMAIL') return sirveCorreo(p);
  if (filtro === 'WHATSAPP') return sirveWhatsApp(p);
  return true;
}

function actualizarPestanas(): void {
  document.querySelectorAll<HTMLButtonElement>('#pl-filtro [data-filtro]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.filtro === FILTRO));
  });
  (['EMAIL', 'WHATSAPP', 'TODAS'] as Filtro[]).forEach((f) => {
    const conteo = $<HTMLElement>(`#pl-filtro [data-conteo="${f}"]`);
    if (conteo) conteo.textContent = String(PLANTILLAS.filter((p) => coincideFiltro(p, f)).length);
  });
  $('#pl-filtro-ayuda')!.textContent = AYUDA_FILTRO[FILTRO];
}

function contenidoItem(p: PlantillaMensaje): string {
  if (FILTRO === 'EMAIL') {
    const asunto = p.asunto?.trim() || p.nombre;
    const aviso = p.cuerpo_email?.trim()
      ? ''
      : '<p class="pl-item__aviso">Sin versión correo propia: se envía el texto de WhatsApp con el diseño Firehouse Star.</p>';
    return `<p class="pl-item__asunto"><span>Asunto:</span> ${escaparHtml(asunto)}</p>
      <p class="pl-item__extracto">${escaparHtml(extractoCorreo(p.cuerpo_email?.trim() || p.cuerpo))}</p>${aviso}`;
  }
  return `<p class="pl-item__cuerpo">${escaparHtml(p.cuerpo)}</p>`;
}

function renderLista(supabase: SupabaseClient, onCambio: () => void): void {
  actualizarPestanas();
  const contenedor = $<HTMLElement>('#pl-lista')!;
  const vacio = $<HTMLElement>('#pl-vacio')!;
  contenedor.innerHTML = '';
  const visibles = PLANTILLAS.filter((p) => coincideFiltro(p, FILTRO));
  vacio.hidden = visibles.length > 0;

  visibles.forEach((p) => {
    const item = document.createElement('div');
    item.className = `pl-item${p.activo ? '' : ' pl-item--inactiva'}`;
    const conCorreo = sirveCorreo(p) && p.cuerpo_email;
    item.innerHTML = `
      <div>
        <p class="pl-item__nombre">${escaparHtml(p.nombre)} · <span class="admin-badge admin-badge--journey">${CANAL_LABEL[p.canal] ?? p.canal}</span>${
          p.categoria === 'CLASE_PRUEBA' ? ' <span class="admin-badge admin-badge--journey">Clase de prueba</span>' : ''
        }${conCorreo ? ' <span class="admin-badge admin-badge--journey">Correo con diseño</span>' : ''}${
          p.activo ? '' : ' <span class="admin-badge admin-badge--estado-cerrado-no">Inactiva</span>'
        }</p>
        ${contenidoItem(p)}
      </div>
      <div class="pl-item__acciones">
        <button type="button" class="pl-item__accion pl-item__accion--ver">Previsualizar</button>
        <button type="button" class="pl-item__accion pl-item__accion--editar">Editar</button>
        <button type="button" class="pl-item__accion pl-item__accion--eliminar">Eliminar</button>
      </div>
    `;
    item.querySelector('.pl-item__accion--ver')!.addEventListener('click', () => abrirPrevia(p));
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

export async function iniciarPlantillas(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const recargar = async () => {
    try {
      PLANTILLAS = await obtenerPlantillas(supabase);
      $('#pl-cargando')?.setAttribute('hidden', '');
      renderLista(supabase, recargar);
    } catch {
      $('#pl-cargando')?.setAttribute('hidden', '');
      mostrarError('No pudimos cargar las plantillas. Si aún no ejecutas la migración 0012, ejecútala en Supabase.');
    }
  };

  // Los datos de ejemplo van primero: el listado y las vistas previas los usan.
  await prepararEjemplo(supabase);
  await recargar();
  actualizarVisibilidadCanal();
  conectarDialogo(supabase);

  document.querySelectorAll<HTMLButtonElement>('#pl-filtro [data-filtro]').forEach((b) => {
    b.addEventListener('click', () => {
      FILTRO = b.dataset.filtro as Filtro;
      renderLista(supabase, recargar);
    });
  });

  $('#pl-btn-nueva')!.addEventListener('click', () => {
    limpiarFormulario();
    $<HTMLSelectElement>('#pl-canal')!.value = FILTRO === 'WHATSAPP' ? 'WHATSAPP' : 'AMBOS';
    actualizarVisibilidadCanal();
    irAlFormulario();
    $<HTMLInputElement>('#pl-nombre')!.focus({ preventScroll: true });
  });

  const botonPrueba = $<HTMLButtonElement>('#pl-btn-prueba')!;
  botonPrueba.addEventListener('click', () => {
    const { correo } = armarPrevia(leerFormulario());
    if (correo) void enviarPrueba(supabase, correo, $<HTMLElement>('#pl-prueba-estado')!, botonPrueba);
  });

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
