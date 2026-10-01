import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  agruparPrimerasClases,
  agregarAlumnasStar,
  enviarCorreoAdmin,
  actualizarCaso,
  agregarInteraccion,
  registrarVisitaRapida,
  validarDatosVisitaRapida,
  type CasoResumen,
  type ItemPrimeraClase,
} from '../lib/crm/admin-api.ts';
import {
  guardarTalla,
  obtenerEnvios,
  obtenerFirma,
  obtenerPlantillasClasePrueba,
  obtenerTallas,
  obtenerValorInscripcionStar,
  registrarEnvio,
  sirveParaCorreo,
  sirveParaWhatsApp,
  type CanalEnvio,
  type EnvioPlantilla,
  type Firma,
  type PlantillaClasePrueba,
} from '../lib/crm/admin-mensajes-api.ts';
import { etiquetaDia, HORA_CLASE_PRUEBA, type DiaClasePrueba } from '../lib/crm/clase-prueba.ts';
import { obtenerAsistencias, grabarAsistencia, type DeportistaAsistencia } from '../lib/crm/admin-asistencia-api.ts';
import {
  alternar,
  cambiosDeFecha,
  cantidadCambios,
  combinarAlRecargar,
  confirmarGrabado,
  porcentaje,
  textoCambios,
  textoPresentes,
  totalCambios,
  type AsistenciaFecha,
} from '../lib/crm/asistencia.ts';
import { calcularEdad } from '../lib/crm/validation.ts';
import { CRM_ESTADOS, CRM_JOURNEYS } from '../lib/crm/constants.ts';
import { mensajeErrorSupabase, escaparHtml } from '../lib/crm/format.ts';
import {
  cargoEnMensaje,
  completarPlantilla,
  enlaceWhatsApp,
  fechaClaseTexto,
  mensajeFaltantes,
  primerNombre,
  variablesUsadas,
} from '../lib/crm/plantillas.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generarLinkPago } from '../lib/crm/admin-cuenta-api.ts';
import { obtenerConfigAcademia, obtenerHorariosClasePrueba } from '../lib/crm/admin-config-api.ts';
import { CONFIG_RESPALDO, type ConfigAcademia, type HorarioClasePrueba } from '../lib/crm/config-academia.ts';
import { renderizarCorreo, type CorreoRenderizado } from '../lib/crm/correo-plantilla.ts';
import { opcionesDeFecha, validarNuevaFecha, type ReglasFecha } from '../lib/crm/clase-fecha.ts';
import { hoyChile } from '../lib/crm/programas.ts';
import { abrirEnvioGrupal } from './admin-clase-prueba-grupo.ts';
import {
  FILTRO_CLASE_LABEL,
  ORDEN_CLASE_LABEL,
  csvAsistencia,
  cumpleBusqueda,
  cumpleFiltro,
  filasAsistencia,
  htmlAsistencia,
  ordenarItems,
  type FiltroClase,
  type OrdenClase,
} from '../lib/crm/clase-prueba-lista.ts';
import {
  coincidePrograma,
  contarPorPrograma,
  leerSeleccion,
  montarSelectorPrograma,
  type SeleccionPrograma,
} from '../lib/crm/programa-filtro.ts';

/** Datos para los mensajes con plantilla. Si la migración 0009 falta, `activo` es false. */
interface ContextoMensajes {
  activo: boolean;
  firma: Firma;
  plantillas: PlantillaClasePrueba[];
  envios: EnvioPlantilla[];
  tallas: Map<string, string | null>;
  valorInscripcion: string | null;
}

function esStar(caso: CasoResumen): boolean {
  return caso.journey === CRM_JOURNEYS.CLASE_PRUEBA_STAR || caso.journey === CRM_JOURNEYS.FIREHOUSE_STAR;
}

// Configuración editable en /admin/configuracion (migración 0012). Si no se
// puede leer, se usan los valores de respaldo del código.
let CONFIG: ConfigAcademia = CONFIG_RESPALDO;
let HORARIOS = new Map<string, HorarioClasePrueba>();

async function cargarConfiguracion(supabase: SupabaseClient): Promise<void> {
  const [config, horarios] = await Promise.all([
    obtenerConfigAcademia(supabase).catch(() => null),
    obtenerHorariosClasePrueba(supabase).catch(() => null),
  ]);
  if (config) CONFIG = config.config;
  if (horarios?.conHorario) HORARIOS = new Map(horarios.horarios.map((h) => [h.dia, h]));
}

function horaClase(caso: CasoResumen): string | null {
  if (esStar(caso)) return CONFIG.starHoraInicio;
  const dia = caso.dia_clase_prueba as DiaClasePrueba | null;
  return dia ? (HORARIOS.get(dia)?.horaInicio ?? HORA_CLASE_PRUEBA[dia]) : null;
}

function horaFinClase(caso: CasoResumen): string | null {
  if (esStar(caso)) return CONFIG.starHoraFin;
  const dia = caso.dia_clase_prueba as DiaClasePrueba | null;
  return dia ? (HORARIOS.get(dia)?.horaFin ?? null) : null;
}

function tallasDisponibles(actual: string): string[] {
  return actual && !CONFIG.tallas.includes(actual) ? [...CONFIG.tallas, actual] : CONFIG.tallas;
}

const CANAL_TEXTO: Record<CanalEnvio, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Correo' };

/**
 * Una plantilla que invita a pagar la inscripción no se envía a quien ya la
 * pagó (el caso queda "Inscrito" al pagar el kit o la inscripción).
 */
function avisoYaInscrito(caso: CasoResumen, plantilla: PlantillaClasePrueba): string | null {
  if (caso.estado !== CRM_ESTADOS.INSCRITO) return null;
  const textos = `${plantilla.asunto ?? ''}\n${plantilla.cuerpo}\n${plantilla.cuerpo_email ?? ''}`;
  return variablesUsadas(textos).includes('valor_inscripcion')
    ? 'Esta familia ya pagó la inscripción: este mensaje la invita a pagarla de nuevo. Elige otro mensaje.'
    : null;
}

/** Datos de la plantilla para un deportista del listado. */
function datosPara(item: ItemPrimeraClase, ctx: ContextoMensajes, linkPago: string | null) {
  const caso = item.caso;
  return {
    nombre_apoderado: primerNombre(caso.atleta.apoderado.nombre),
    nombre_atleta: primerNombre(caso.atleta.nombre),
    remitente: ctx.firma.nombre,
    cargo: cargoEnMensaje(ctx.firma.cargo),
    fecha_clase: fechaClaseTexto(item.fecha),
    hora_clase: horaClase(caso),
    talla: ctx.tallas.get(caso.atleta.id) ?? null,
    valor_inscripcion: ctx.valorInscripcion,
    link_pago: linkPago,
  };
}

/** Correo con diseño de una plantilla para un deportista del listado. */
function correoPara(
  item: ItemPrimeraClase,
  plantilla: PlantillaClasePrueba,
  ctx: ContextoMensajes,
  linkPago: string | null,
  avisoInterno?: string[],
) {
  return renderizarCorreo({
    avisoInterno,
    asunto: plantilla.asunto?.trim() || plantilla.nombre,
    cuerpo: plantilla.cuerpo_email?.trim() || plantilla.cuerpo,
    datos: datosPara(item, ctx, linkPago),
    clase: { etiqueta: esStar(item.caso) ? 'Tu primera clase' : 'Tu clase de prueba', horaFin: horaFinClase(item.caso) },
  });
}

function necesitaLinkCorreo(plantilla: PlantillaClasePrueba): boolean {
  return variablesUsadas(`${plantilla.asunto ?? ''}\n${plantilla.cuerpo_email ?? plantilla.cuerpo}`).includes('link_pago');
}

/** Muestra el correo tal como llegará y resuelve true si se confirma el envío. */
function confirmarCorreo(para: string, correo: CorreoRenderizado): Promise<boolean> {
  const dialogo = $<HTMLDialogElement>('#cp-dialogo-correo')!;
  $<HTMLElement>('#cp-correo-para')!.textContent = para;
  $<HTMLElement>('#cp-correo-asunto')!.textContent = correo.asunto;
  $<HTMLIFrameElement>('#cp-correo-previa')!.srcdoc = correo.html;
  const enviar = $<HTMLButtonElement>('#cp-correo-enviar')!;
  const cancelar = $<HTMLButtonElement>('#cp-correo-cancelar')!;
  return new Promise((resolver) => {
    const cerrar = (valor: boolean) => {
      enviar.onclick = null;
      cancelar.onclick = null;
      dialogo.onclose = null;
      if (dialogo.open) dialogo.close();
      resolver(valor);
    };
    enviar.onclick = () => cerrar(true);
    cancelar.onclick = () => cerrar(false);
    dialogo.onclose = () => cerrar(false);
    dialogo.showModal();
  });
}

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

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
}

function renderEnviados(contenedor: HTMLElement, caso: CasoResumen, ctx: ContextoMensajes): void {
  const envios = ctx.envios.filter((e) => e.caso_id === caso.id);
  contenedor.innerHTML = envios
    .map((e) => {
      const p = ctx.plantillas.find((x) => x.id === e.plantilla_id);
      const canal = e.tipo === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
      return `<span class="cp-enviado${canal === 'EMAIL' ? ' cp-enviado--correo' : ''}">✓ ${escaparHtml(p?.nombre ?? 'Plantilla')} · ${
        CANAL_TEXTO[canal]
      } · ${fechaCorta(e.fecha)}</span>`;
    })
    .join('');
}

function bloqueMensajes(item: ItemPrimeraClase, supabase: SupabaseClient, ctx: ContextoMensajes): HTMLElement {
  const caso = item.caso;
  const bloque = document.createElement('div');
  bloque.className = 'cp-mensajes';
  const idTalla = `cp-talla-${caso.id}`;
  const idPlantilla = `cp-plantilla-${caso.id}`;
  const tallaActual = ctx.tallas.get(caso.atleta.id) ?? '';

  bloque.innerHTML = `
    <div class="cp-mensajes__campos">
      <div>
        <label class="admin-label" for="${idTalla}">Talla de polera</label>
        <select id="${idTalla}" class="admin-select cp-select-talla">
          <option value="">Sin registrar</option>
          ${tallasDisponibles(tallaActual).map((t) => `<option value="${t}" ${t === tallaActual ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="cp-mensajes__plantilla">
        <label class="admin-label" for="${idPlantilla}">Mensaje</label>
        <select id="${idPlantilla}" class="admin-select">
          ${ctx.plantillas.map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="cp-mensajes__botones">
        <button type="button" class="admin-btn admin-btn--whatsapp cp-btn-enviar">Enviar por WhatsApp</button>
        <button type="button" class="admin-btn admin-btn--secundario cp-btn-correo">Enviar por correo</button>
      </div>
    </div>
    <p class="cp-mensajes__aviso" hidden></p>
    <div class="cp-enviados"></div>`;

  const selectTalla = bloque.querySelector<HTMLSelectElement>(`#${CSS.escape(idTalla)}`)!;
  const selectPlantilla = bloque.querySelector<HTMLSelectElement>(`#${CSS.escape(idPlantilla)}`)!;
  const boton = bloque.querySelector<HTMLButtonElement>('.cp-btn-enviar')!;
  const botonCorreo = bloque.querySelector<HTMLButtonElement>('.cp-btn-correo')!;
  const email = caso.atleta.apoderado.email?.trim() ?? '';
  const aviso = bloque.querySelector<HTMLElement>('.cp-mensajes__aviso')!;
  const enviados = bloque.querySelector<HTMLElement>('.cp-enviados')!;
  renderEnviados(enviados, caso, ctx);

  // Sugiere el primer mensaje que aún no se envía.
  const siguiente = ctx.plantillas.find(
    (p) => !avisoYaInscrito(caso, p) && !ctx.envios.some((e) => e.caso_id === caso.id && e.plantilla_id === p.id),
  );
  if (siguiente) selectPlantilla.value = siguiente.id;

  // Cada botón se habilita según el canal de la plantilla elegida.
  const actualizarBotones = () => {
    const p = ctx.plantillas.find((x) => x.id === selectPlantilla.value);
    boton.disabled = !p || !sirveParaWhatsApp(p);
    botonCorreo.disabled = !p || !sirveParaCorreo(p) || !email;
    botonCorreo.title = email ? '' : 'Este apoderado no tiene correo registrado.';
  };
  actualizarBotones();
  selectPlantilla.addEventListener('change', () => {
    aviso.hidden = true;
    actualizarBotones();
  });

  selectTalla.addEventListener('change', async () => {
    aviso.hidden = true;
    selectTalla.disabled = true;
    try {
      await guardarTalla(supabase, caso.atleta.id, selectTalla.value || null);
      ctx.tallas.set(caso.atleta.id, selectTalla.value || null);
    } catch (err) {
      aviso.textContent = mensajeErrorSupabase(err, 'No pudimos guardar la talla.');
      aviso.hidden = false;
    } finally {
      selectTalla.disabled = false;
    }
  });

  const datosPlantilla = (linkPago: string | null) => datosPara(item, ctx, linkPago);

  const registrar = (plantilla: PlantillaClasePrueba, canal: CanalEnvio = 'WHATSAPP') =>
    registrarEnvio(supabase, caso.id, plantilla, canal)
      .then(() => {
        ctx.envios.push({ caso_id: caso.id, plantilla_id: plantilla.id, fecha: new Date().toISOString(), tipo: canal });
        renderEnviados(enviados, caso, ctx);
        const proxima = ctx.plantillas.find((p) => !ctx.envios.some((e) => e.caso_id === caso.id && e.plantilla_id === p.id));
        if (proxima) selectPlantilla.value = proxima.id;
        actualizarBotones();
      })
      .catch((err) => {
        const texto =
          canal === 'EMAIL'
            ? 'El correo se envió, pero no pudimos registrar el envío.'
            : 'El mensaje se abrió en WhatsApp, pero no pudimos registrar el envío.';
        aviso.textContent = mensajeErrorSupabase(err, texto);
        aviso.hidden = false;
      });

  const correoDe = (plantilla: PlantillaClasePrueba, linkPago: string | null) => correoPara(item, plantilla, ctx, linkPago);

  botonCorreo.addEventListener('click', async () => {
    aviso.hidden = true;
    aviso.classList.remove('cp-mensajes__aviso--ok');
    const plantilla = ctx.plantillas.find((p) => p.id === selectPlantilla.value);
    if (!plantilla || !email) return;
    const yaInscrito = avisoYaInscrito(caso, plantilla);
    if (yaInscrito) {
      aviso.textContent = yaInscrito;
      aviso.hidden = false;
      return;
    }
    const necesitaLink = necesitaLinkCorreo(plantilla);

    // Se revisan los datos con un link provisorio antes de crear cargos.
    const previa = correoDe(plantilla, necesitaLink ? 'https://firehousecheer.cl' : null);
    if (previa.faltantes.length > 0) {
      aviso.textContent = mensajeFaltantes(previa.faltantes);
      aviso.hidden = false;
      return;
    }

    botonCorreo.disabled = true;
    try {
      const correo = necesitaLink
        ? correoDe(plantilla, (await generarLinkPago(supabase, { atletaId: caso.atleta.id })).url)
        : previa;
      if (!(await confirmarCorreo(email, correo))) return;
      await enviarCorreoAdmin(supabase, email, correo.asunto, correo.html, correo.texto);
      aviso.textContent = `Correo enviado a ${email} ✓`;
      aviso.classList.add('cp-mensajes__aviso--ok');
      aviso.hidden = false;
      void registrar(plantilla, 'EMAIL');
    } catch (err) {
      aviso.classList.remove('cp-mensajes__aviso--ok');
      aviso.textContent = err instanceof Error ? err.message : 'No pudimos enviar el correo.';
      aviso.hidden = false;
    } finally {
      actualizarBotones();
    }
  });

  boton.addEventListener('click', async () => {
    aviso.hidden = true;
    aviso.classList.remove('cp-mensajes__aviso--ok');
    const plantilla = ctx.plantillas.find((p) => p.id === selectPlantilla.value);
    if (!plantilla) return;
    const yaInscrito = avisoYaInscrito(caso, plantilla);
    if (yaInscrito) {
      aviso.textContent = yaInscrito;
      aviso.hidden = false;
      return;
    }
    const necesitaLink = variablesUsadas(plantilla.cuerpo).includes('link_pago');

    // Primero se revisa todo lo demás, con un link provisorio.
    const previa = completarPlantilla(plantilla.cuerpo, datosPlantilla(necesitaLink ? 'pendiente' : null));
    if (previa.faltantes.length > 0) {
      aviso.textContent = mensajeFaltantes(previa.faltantes);
      aviso.hidden = false;
      return;
    }
    if (!necesitaLink) {
      // Se abre WhatsApp antes de cualquier espera, para que el navegador no lo bloquee.
      window.open(enlaceWhatsApp(caso.atleta.apoderado.telefono, previa.texto), '_blank', 'noopener');
      void registrar(plantilla);
      return;
    }

    // Con link de pago: la ventana se abre ya (evita el bloqueo) y se completa
    // cuando el servidor prepara los cargos Star y el link de la familia.
    const ventana = window.open('', '_blank');
    boton.disabled = true;
    try {
      const { url } = await generarLinkPago(supabase, { atletaId: caso.atleta.id });
      const { texto } = completarPlantilla(plantilla.cuerpo, datosPlantilla(url));
      const destino = enlaceWhatsApp(caso.atleta.apoderado.telefono, texto);
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = destino;
      } else {
        aviso.innerHTML = `El navegador bloqueó la ventana. <a href="${destino}" target="_blank" rel="noopener">Abrir WhatsApp</a>`;
        aviso.hidden = false;
      }
      void registrar(plantilla);
    } catch (err) {
      ventana?.close();
      aviso.textContent = err instanceof Error ? err.message : 'No pudimos preparar el link de pago.';
      aviso.hidden = false;
    } finally {
      boton.disabled = false;
    }
  });

  return bloque;
}

/** Vuelve a cargar el listado (lo asigna renderizarLista). */
let RECARGAR: () => Promise<void> = async () => {};

function reglasFecha(caso: CasoResumen): ReglasFecha {
  return {
    esStar: esStar(caso),
    hoy: hoyChile(),
    primeraClaseStar: CONFIG.starPrimeraClase,
    diasHabilitados: {
      VIERNES: HORARIOS.get('VIERNES')?.habilitado ?? true,
      SABADO: HORARIOS.get('SABADO')?.habilitado ?? true,
    },
  };
}

function textoFechaOpcion(fecha: string): string {
  const t = fechaClaseTexto(fecha) ?? fecha;
  return t.replace(/^el /, '').replace(/^./, (c) => c.toUpperCase());
}

/** Control para cambiar la fecha de la clase (prueba o primera clase Star). */
function controlFecha(item: ItemPrimeraClase, supabase: SupabaseClient): { enlace: HTMLButtonElement; panel: HTMLElement } {
  const caso = item.caso;
  const enlace = document.createElement('button');
  enlace.type = 'button';
  enlace.className = 'cp-link-fecha';
  enlace.textContent = 'Cambiar fecha';

  const panel = document.createElement('div');
  panel.className = 'cp-fecha';
  panel.hidden = true;
  const idSelect = `cp-fecha-${caso.id}`;
  const reglas = reglasFecha(caso);
  const opciones = opcionesDeFecha(reglas, item.fecha, 8);
  panel.innerHTML = `
    <label class="admin-label" for="${idSelect}">${item.tipo === 'INSCRIPCION' ? 'Nueva fecha de su primera clase' : 'Nueva fecha de la clase de prueba'}</label>
    <div class="cp-fecha__campos">
      <select id="${idSelect}" class="admin-select">
        ${opciones.map((f) => `<option value="${f}" ${f === item.fecha ? 'selected' : ''}>${escaparHtml(textoFechaOpcion(f))}${f === item.fecha ? ' (actual)' : ''}</option>`).join('')}
      </select>
      <button type="button" class="admin-btn cp-fecha__guardar">Guardar</button>
      <button type="button" class="admin-btn admin-btn--secundario cp-fecha__cancelar">Cancelar</button>
    </div>
    <p class="cp-fecha__nota">Los mensajes que envíes después usarán la nueva fecha. Queda registrado en la ficha del caso.</p>
    <p class="cp-mensajes__aviso" hidden></p>`;

  const select = panel.querySelector<HTMLSelectElement>('select')!;
  const aviso = panel.querySelector<HTMLElement>('.cp-mensajes__aviso')!;
  const guardar = panel.querySelector<HTMLButtonElement>('.cp-fecha__guardar')!;
  enlace.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  panel.querySelector('.cp-fecha__cancelar')!.addEventListener('click', () => {
    panel.hidden = true;
    select.value = item.fecha;
  });
  guardar.addEventListener('click', async () => {
    aviso.hidden = true;
    const nueva = select.value;
    if (nueva === item.fecha) {
      panel.hidden = true;
      return;
    }
    const v = validarNuevaFecha(nueva, reglas);
    if (!v.ok) {
      aviso.textContent = v.error;
      aviso.hidden = false;
      return;
    }
    guardar.disabled = true;
    try {
      await actualizarCaso(supabase, caso.id, { fecha_clase_prueba: nueva, dia_clase_prueba: v.dia });
      const que = item.tipo === 'INSCRIPCION' ? 'Primera clase Firehouse Star' : 'Clase de prueba';
      await agregarInteraccion(supabase, caso.id, 'NOTA', `${que} cambiada: ${textoFechaOpcion(item.fecha)} → ${textoFechaOpcion(nueva)}`).catch(() => {});
      await RECARGAR();
    } catch (err) {
      aviso.textContent = mensajeErrorSupabase(err, 'No pudimos cambiar la fecha.');
      aviso.hidden = false;
      guardar.disabled = false;
    }
  });
  return { enlace, panel };
}

// ---------------------------------------------------------------------------
// Asistencia (migración 0016): se marca en pantalla y se graba con un botón.

/** fecha → asistencia grabada y marcada en pantalla. */
const ASISTENCIA = new Map<string, AsistenciaFecha>();
/** fecha → atleta_id → ítem del listado (para saber el caso de cada deportista). */
const ITEMS_POR_FECHA = new Map<string, Map<string, ItemPrimeraClase>>();
/** false mientras la migración 0016 no esté aplicada. */
let ASISTENCIA_DISPONIBLE = true;

function asistenciaDe(fecha: string): AsistenciaFecha {
  let a = ASISTENCIA.get(fecha);
  if (!a) {
    a = combinarAlRecargar(undefined, []);
    ASISTENCIA.set(fecha, a);
  }
  return a;
}

function estaPresente(item: ItemPrimeraClase): boolean {
  return asistenciaDe(item.fecha).marcadas.has(item.caso.atleta.id);
}

function tipoDe(item: ItemPrimeraClase): { texto: string; clase: string } {
  if (item.tipo === 'INSCRIPCION') return { texto: 'Star · 1ª clase', clase: 'cp-tipo--star' };
  if (item.tipo === 'ALUMNA') return { texto: 'Star', clase: 'cp-tipo--star' };
  return esStar(item.caso) ? { texto: 'Prueba Star', clase: 'cp-tipo--star' } : { texto: 'Prueba', clase: 'cp-tipo--prueba' };
}

const ICONO_MAS =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle></svg>';

/**
 * Una fila: check de asistencia, nombre y una línea de detalle. Contacto,
 * cambio de fecha, talla y mensajes quedan en un panel que se abre con "⋯".
 */
function filaCaso(item: ItemPrimeraClase, supabase: SupabaseClient, ctx: ContextoMensajes, alCambiar: () => void): HTMLElement {
  const caso = item.caso;
  const atletaId = caso.atleta.id;
  const presente = estaPresente(item);
  const fila = document.createElement('div');
  fila.className = `cp-fila${presente ? ' cp-fila--presente' : ''}`;

  const nombre = `${caso.atleta.nombre} ${caso.atleta.apellidos}`.trim();
  const edad = calcularEdad(caso.atleta.fecha_nacimiento, new Date(`${item.fecha}T12:00:00Z`))?.edad;
  const tipo = tipoDe(item);
  const kitPendiente = item.tipo !== 'PRUEBA' && caso.estado !== CRM_ESTADOS.INSCRITO;
  const dia = !esStar(caso) && caso.dia_clase_prueba ? etiquetaDia(caso.dia_clase_prueba as DiaClasePrueba) : '';
  const hora = horaClase(caso);
  const idCheck = `cp-check-${caso.id}`;
  const idPanel = `cp-panel-${caso.id}`;
  const telefono = caso.atleta.apoderado.telefono;

  fila.innerHTML = `
    <div class="cp-fila__principal">
      <label class="cp-fila__marca" for="${idCheck}">
        <input type="checkbox" id="${idCheck}" class="cp-check" ${presente ? 'checked' : ''} ${ASISTENCIA_DISPONIBLE ? '' : 'disabled'} />
        <span class="cp-fila__textos">
          <span class="cp-fila__nombre">${escaparHtml(nombre)}</span>
          <span class="cp-fila__detalle">${edad !== undefined && edad !== null ? `${edad} años · ` : ''}<span class="cp-tipo ${tipo.clase}">${tipo.texto}</span>${
            kitPendiente ? ' · <span class="cp-kit">Kit pendiente</span>' : ''
          }${dia ? ` · ${escaparHtml(dia)}` : ''}</span>
        </span>
      </label>
      <button type="button" class="cp-fila__mas" aria-expanded="false" aria-controls="${idPanel}" aria-label="Contacto, mensajes y fecha de ${escaparHtml(nombre)}">${ICONO_MAS}</button>
    </div>
    <div class="cp-fila__panel" id="${idPanel}" hidden>
      <p class="cp-fila__contacto">${escaparHtml(`${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}`.trim())} · <a href="tel:${escaparHtml(
        telefono.replace(/[^+\d]/g, ''),
      )}">${escaparHtml(telefono)}</a>${hora ? ` · ${escaparHtml(hora)}` : ''} · <a href="/admin/caso?id=${encodeURIComponent(caso.id)}">Ver ficha</a></p>
      ${caso.comentario_inicial ? `<p class="cp-fila__nota">${escaparHtml(caso.comentario_inicial)}</p>` : ''}
    </div>`;

  const check = fila.querySelector<HTMLInputElement>('.cp-check')!;
  check.addEventListener('change', () => {
    alternar(asistenciaDe(item.fecha), atletaId, check.checked);
    fila.classList.toggle('cp-fila--presente', check.checked);
    alCambiar();
  });

  // El panel se arma la primera vez que se abre: la lista carga más rápido.
  const panel = fila.querySelector<HTMLElement>('.cp-fila__panel')!;
  const boton = fila.querySelector<HTMLButtonElement>('.cp-fila__mas')!;
  let armado = false;
  boton.addEventListener('click', () => {
    if (!armado) {
      // La fecha se cambia solo en la clase de prueba o la primera clase, no en la clase semanal.
      if (item.tipo !== 'ALUMNA') {
        const fecha = controlFecha(item, supabase);
        panel.querySelector('.cp-fila__contacto')!.append(' · ', fecha.enlace);
        panel.appendChild(fecha.panel);
      }
      if (ctx.activo && ctx.plantillas.length > 0) panel.appendChild(bloqueMensajes(item, supabase, ctx));
      armado = true;
    }
    panel.hidden = !panel.hidden;
    boton.setAttribute('aria-expanded', String(!panel.hidden));
    fila.classList.toggle('cp-fila--abierta', !panel.hidden);
  });
  return fila;
}

/** Barra inferior: cambios sin grabar y botón "Grabar asistencia". */
let AVISO_BARRA: { texto: string; tipo: 'ok' | 'error' } | null = null;
let TIMER_BARRA: ReturnType<typeof setTimeout> | undefined;

function actualizarBarra(): void {
  const barra = $<HTMLElement>('#cp-barra-asistencia');
  if (!barra) return;
  const n = totalCambios(ASISTENCIA);
  const texto = $<HTMLElement>('#cp-barra-texto')!;
  const grabar = $<HTMLButtonElement>('#cp-barra-grabar')!;
  barra.classList.toggle('cp-barra--ok', n === 0 && AVISO_BARRA?.tipo === 'ok');
  barra.classList.toggle('cp-barra--error', AVISO_BARRA?.tipo === 'error');
  if (n > 0) {
    texto.textContent = AVISO_BARRA?.tipo === 'error' ? AVISO_BARRA.texto : `${textoCambios(n)} sin grabar`;
    grabar.hidden = false;
    barra.hidden = false;
  } else if (AVISO_BARRA) {
    texto.textContent = AVISO_BARRA.texto;
    grabar.hidden = true;
    barra.hidden = false;
  } else {
    barra.hidden = true;
  }
  document.body.classList.toggle('cp-con-barra', !barra.hidden);
}

function avisoBarra(texto: string, tipo: 'ok' | 'error'): void {
  AVISO_BARRA = { texto, tipo };
  clearTimeout(TIMER_BARRA);
  if (tipo === 'ok') {
    TIMER_BARRA = setTimeout(() => {
      AVISO_BARRA = null;
      actualizarBarra();
    }, 4000);
  }
  actualizarBarra();
}

const ESTADOS_ANTES_DE_LA_CLASE: readonly string[] = [
  CRM_ESTADOS.NUEVO,
  CRM_ESTADOS.CONTACTADO,
  CRM_ESTADOS.SEGUIMIENTO,
  CRM_ESTADOS.AGENDADO,
  CRM_ESTADOS.NO_RESPONDE,
];

/** Refleja en pantalla el cambio de estado que hace fn_grabar_asistencia en las clases de prueba. */
function reflejarEstado(item: ItemPrimeraClase | undefined, presente: boolean): void {
  if (!item || item.tipo !== 'PRUEBA') return;
  if (presente && ESTADOS_ANTES_DE_LA_CLASE.includes(item.caso.estado)) item.caso.estado = CRM_ESTADOS.ASISTIO;
  if (!presente && item.caso.estado === CRM_ESTADOS.ASISTIO) item.caso.estado = CRM_ESTADOS.AGENDADO;
}

async function grabarCambios(supabase: SupabaseClient): Promise<void> {
  const grabar = $<HTMLButtonElement>('#cp-barra-grabar')!;
  grabar.disabled = true;
  grabar.textContent = 'Grabando…';
  AVISO_BARRA = null;
  try {
    for (const [fecha, a] of ASISTENCIA) {
      if (cantidadCambios(a) === 0) continue;
      const items = ITEMS_POR_FECHA.get(fecha) ?? new Map<string, ItemPrimeraClase>();
      const { presentes, ausentes } = cambiosDeFecha(a);
      const payload = (ids: string[]): DeportistaAsistencia[] =>
        ids.map((atleta_id) => ({ atleta_id, caso_id: items.get(atleta_id)?.caso.id ?? '' }));
      await grabarAsistencia(supabase, fecha, payload(presentes), payload(ausentes));
      presentes.forEach((id) => reflejarEstado(items.get(id), true));
      ausentes.forEach((id) => reflejarEstado(items.get(id), false));
      confirmarGrabado(a);
    }
    const ahora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }).format(new Date());
    avisoBarra(`Asistencia grabada · ${ahora} ✓`, 'ok');
  } catch (err) {
    avisoBarra(mensajeErrorSupabase(err, 'No pudimos grabar la asistencia. Revisa tu conexión e inténtalo nuevamente.'), 'error');
  } finally {
    grabar.disabled = false;
    grabar.textContent = 'Grabar asistencia';
    DIBUJAR();
  }
}

function conectarBarraAsistencia(supabase: SupabaseClient): void {
  $('#cp-barra-grabar')?.addEventListener('click', () => void grabarCambios(supabase));
  // Evita perder marcas sin grabar al cerrar o recargar la página.
  window.addEventListener('beforeunload', (e) => {
    if (totalCambios(ASISTENCIA) > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function cargarContexto(supabase: SupabaseClient, casos: CasoResumen[]): Promise<ContextoMensajes> {
  const vacio: ContextoMensajes = {
    activo: false,
    firma: { nombre: null, cargo: null, nombreFirma: null, disponible: false },
    plantillas: [],
    envios: [],
    tallas: new Map(),
    valorInscripcion: null,
  };
  try {
    const [firma, plantillas, envios, tallas, valorInscripcion] = await Promise.all([
      obtenerFirma(supabase),
      obtenerPlantillasClasePrueba(supabase),
      obtenerEnvios(supabase, casos.map((c) => c.id)),
      obtenerTallas(supabase, casos.map((c) => c.atleta.id)),
      obtenerValorInscripcionStar(supabase),
    ]);
    if (!firma.disponible) return vacio;
    return { activo: true, firma, plantillas, envios, tallas, valorInscripcion };
  } catch {
    return vacio;
  }
}

let PROGRAMA: SeleccionPrograma = 'TODOS';
let FILTRO: FiltroClase = 'TODOS';
let ORDEN: OrdenClase = 'ALUMNA';
/** Vuelve a dibujar con los filtros actuales (lo asigna renderizarLista). */
let DIBUJAR: () => void = () => {};

/** Lista de asistencia de una fecha: página imprimible o archivo Excel (CSV). */
function exportarAsistencia(fecha: string, items: ItemPrimeraClase[], ctx: ContextoMensajes, formato: 'IMPRIMIR' | 'EXCEL'): void {
  const filas = filasAsistencia(items, ctx.tallas, fecha);
  const titulo = `Asistencia · ${tituloGrupo(fecha)}`;
  if (formato === 'EXCEL') {
    const blob = new Blob([csvAsistencia(filas)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asistencia-${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const horario = [CONFIG.starHoraInicio, CONFIG.starHoraFin].filter(Boolean).join(' a ');
  const subtitulo = `Firehouse Star y clases de prueba · ${horario ? `${horario} h · ` : ''}Santa Corina 197, La Cisterna`;
  const ventana = window.open('', '_blank');
  if (!ventana) {
    mostrarError('El navegador bloqueó la ventana de la lista. Permite las ventanas emergentes para este sitio.');
    return;
  }
  ventana.document.open();
  ventana.document.write(htmlAsistencia(titulo, subtitulo, filas));
  ventana.document.close();
}

async function renderizarLista(supabase: SupabaseClient): Promise<void> {
  let casos: CasoResumen[];
  try {
    casos = await obtenerCasos(supabase);
  } catch (err) {
    mostrarError(mensajeErrorSupabase(err, 'No pudimos cargar la lista. Recarga la página o inténtalo más tarde.'));
    return;
  }

  RECARGAR = () => renderizarLista(supabase);
  await cargarConfiguracion(supabase);
  const ahora = new Date();
  const todos = agregarAlumnasStar(
    agruparPrimerasClases(casos, ahora, CONFIG.starPrimeraClase, CONFIG.starHoraInicio),
    casos,
    ahora,
    CONFIG.starPrimeraClase,
  );
  const itemsTodos = todos.flatMap((g) => g.items);
  const ctx = await cargarContexto(supabase, itemsTodos.map((i) => i.caso));

  // Asistencia grabada de cada fecha del listado (migración 0016).
  ITEMS_POR_FECHA.clear();
  todos.forEach((g) => ITEMS_POR_FECHA.set(g.fecha, new Map(g.items.map((i) => [i.caso.atleta.id, i]))));
  try {
    const cargadas = await obtenerAsistencias(supabase, todos.map((g) => g.fecha));
    ASISTENCIA_DISPONIBLE = cargadas.disponible;
    cargadas.porFecha.forEach((ids, fecha) => ASISTENCIA.set(fecha, combinarAlRecargar(ASISTENCIA.get(fecha), ids)));
  } catch (err) {
    mostrarError(mensajeErrorSupabase(err, 'No pudimos cargar la asistencia grabada. Recarga la página.'));
    ASISTENCIA_DISPONIBLE = false;
  }
  const avisoAsistencia = $<HTMLElement>('#cp-aviso-asistencia')!;
  avisoAsistencia.hidden = ASISTENCIA_DISPONIBLE;
  avisoAsistencia.textContent = ASISTENCIA_DISPONIBLE
    ? ''
    : 'Para marcar y grabar asistencia falta ejecutar la migración 0016 en el SQL Editor de Supabase.';
  actualizarBarra();

  $('#cp-cargando')?.setAttribute('hidden', '');
  const avisoMensajes = $<HTMLElement>('#cp-aviso-mensajes')!;
  avisoMensajes.hidden = ctx.activo;
  if (!ctx.activo) {
    avisoMensajes.textContent = 'Los mensajes con plantilla estarán disponibles después de ejecutar la migración 0009 en Supabase.';
  }

  const conteo = contarPorPrograma(itemsTodos.map((i) => i.caso));
  if (PROGRAMA === 'SIN_PROGRAMA' && conteo.SIN_PROGRAMA === 0) PROGRAMA = 'TODOS';

  const dibujar = () => {
    const vacio = $<HTMLElement>('#cp-vacio')!;
    const contenedor = $<HTMLElement>('#cp-grupos')!;
    contenedor.innerHTML = '';
    const texto = $<HTMLInputElement>('#cp-buscar')!.value;
    const delPrograma = todos
      .map((g) => ({ fecha: g.fecha, items: g.items.filter((i) => coincidePrograma(i.caso.programa, PROGRAMA)) }))
      .filter((g) => g.items.length > 0);

    // Filtros con su cantidad (sobre el programa elegido y la búsqueda).
    const buscados = delPrograma.flatMap((g) => g.items).filter((i) => cumpleBusqueda(i, texto));
    $<HTMLElement>('#cp-filtro')!.innerHTML = (Object.keys(FILTRO_CLASE_LABEL) as FiltroClase[])
      .map((f) => {
        const n = buscados.filter((i) => cumpleFiltro(i, f, ctx.tallas.get(i.caso.atleta.id), estaPresente(i))).length;
        return `<button type="button" class="cp-chip" data-filtro="${f}" aria-pressed="${f === FILTRO}">${FILTRO_CLASE_LABEL[f]} (${n})</button>`;
      })
      .join('');

    const grupos = delPrograma
      .map((g) => ({
        fecha: g.fecha,
        todos: g.items,
        items: ordenarItems(
          g.items.filter(
            (i) => cumpleBusqueda(i, texto) && cumpleFiltro(i, FILTRO, ctx.tallas.get(i.caso.atleta.id), estaPresente(i)),
          ),
          ORDEN,
        ),
      }))
      .filter((g) => g.items.length > 0);

    if (grupos.length === 0) {
      vacio.textContent = delPrograma.length
        ? 'Ninguna alumna coincide con la búsqueda o el filtro.'
        : 'No hay clases de prueba agendadas todavía.';
      vacio.hidden = false;
      return;
    }
    vacio.hidden = true;

    grupos.forEach((grupo) => {
      const seccion = document.createElement('div');
      seccion.className = 'cp-grupo';
      const pruebas = grupo.todos.filter((i) => i.tipo === 'PRUEBA').length;
      const inscripciones = grupo.todos.length - pruebas;
      const partes = [
        inscripciones ? `${inscripciones} Star` : '',
        pruebas ? `${pruebas} ${pruebas === 1 ? 'prueba' : 'pruebas'}` : '',
      ].filter(Boolean);
      const filtrado = grupo.items.length !== grupo.todos.length ? ` · mostrando ${grupo.items.length}` : '';
      const horario = [CONFIG.starHoraInicio, CONFIG.starHoraFin].filter(Boolean).join('–');

      const cabecera = document.createElement('div');
      cabecera.className = 'cp-grupo__cabecera';
      cabecera.innerHTML = `
        <div class="cp-grupo__encabezado">
          <p class="cp-grupo__titulo">${escaparHtml(tituloGrupo(grupo.fecha))}</p>
          <p class="cp-grupo__sub">${escaparHtml([horario, partes.join(' · ')].filter(Boolean).join(' · '))}${escaparHtml(filtrado)}</p>
        </div>
        <div class="cp-grupo__conteo">
          <span class="cp-grupo__barra" aria-hidden="true"><span class="cp-grupo__barra-relleno"></span></span>
          <span class="cp-grupo__conteo-texto"></span>
        </div>`;
      const relleno = cabecera.querySelector<HTMLElement>('.cp-grupo__barra-relleno')!;
      const conteoTexto = cabecera.querySelector<HTMLElement>('.cp-grupo__conteo-texto')!;
      const actualizarConteo = () => {
        const presentes = grupo.todos.filter((i) => estaPresente(i)).length;
        conteoTexto.textContent = textoPresentes(presentes, grupo.todos.length);
        relleno.style.width = `${porcentaje(presentes, grupo.todos.length)}%`;
      };
      actualizarConteo();

      const botones = document.createElement('div');
      botones.className = 'cp-grupo__botones';
      const accion = (texto: string, titulo: string, alClic: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-grupo__accion';
        b.textContent = texto;
        b.title = titulo;
        b.addEventListener('click', alClic);
        botones.appendChild(b);
      };
      if (ctx.activo && ctx.plantillas.some((p) => sirveParaCorreo(p))) {
        accion('Correo al grupo', 'Enviar un correo con plantilla a todo el grupo', () =>
          abrirEnvioGrupal({
            supabase,
            titulo: tituloGrupo(grupo.fecha),
            items: grupo.todos,
            plantillas: ctx.plantillas.filter((p) => sirveParaCorreo(p)),
            envios: ctx.envios,
            correoPara: (item, plantilla, link, aviso) => correoPara(item, plantilla, ctx, link, aviso),
            necesitaLink: necesitaLinkCorreo,
            bloqueo: avisoYaInscrito,
            alTerminar: () => RECARGAR(),
          }),
        );
      }
      // La lista impresa y el Excel siempre incluyen a todos los de esa fecha (del programa elegido).
      accion('Imprimir lista', 'Lista para imprimir o guardar como PDF', () => exportarAsistencia(grupo.fecha, grupo.todos, ctx, 'IMPRIMIR'));
      accion('Excel', 'Descargar la lista para abrir en Excel', () => exportarAsistencia(grupo.fecha, grupo.todos, ctx, 'EXCEL'));
      cabecera.appendChild(botones);
      seccion.appendChild(cabecera);

      const lista = document.createElement('div');
      lista.className = 'cp-lista';
      grupo.items.forEach((i) =>
        lista.appendChild(
          filaCaso(i, supabase, ctx, () => {
            actualizarConteo();
            AVISO_BARRA = AVISO_BARRA?.tipo === 'error' ? AVISO_BARRA : null;
            actualizarBarra();
          }),
        ),
      );
      seccion.appendChild(lista);
      contenedor.appendChild(seccion);
    });
  };

  montarSelectorPrograma($<HTMLElement>('#cp-programa')!, conteo, PROGRAMA, (v) => {
    PROGRAMA = v;
    dibujar();
  });
  DIBUJAR = dibujar;
  dibujar();
}

/** Búsqueda, filtros y orden del listado (se conectan una sola vez). */
function conectarHerramientas(): void {
  const orden = $<HTMLSelectElement>('#cp-orden')!;
  orden.innerHTML = (Object.keys(ORDEN_CLASE_LABEL) as OrdenClase[])
    .map((o) => `<option value="${o}">Ordenar: ${ORDEN_CLASE_LABEL[o]}</option>`)
    .join('');
  orden.addEventListener('change', () => {
    ORDEN = orden.value as OrdenClase;
    DIBUJAR();
  });
  $('#cp-buscar')!.addEventListener('input', () => DIBUJAR());
  $('#cp-filtro')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filtro]');
    if (!b) return;
    FILTRO = b.dataset.filtro as FiltroClase;
    DIBUJAR();
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
      apoderadoNombre: $<HTMLInputElement>('#vr-apoderado-nombre')!.value,
      apoderadoApellidos: $<HTMLInputElement>('#vr-apoderado-apellidos')!.value,
      apoderadoTelefono: $<HTMLInputElement>('#vr-telefono')!.value,
      apoderadoEmail: $<HTMLInputElement>('#vr-email')!.value,
      nota: $<HTMLTextAreaElement>('#vr-nota')!.value,
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
  PROGRAMA = leerSeleccion();

  conectarVisitaRapida(supabase);
  conectarHerramientas();
  conectarBarraAsistencia(supabase);
  await renderizarLista(supabase);
}
