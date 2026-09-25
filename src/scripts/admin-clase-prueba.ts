import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  agruparPrimerasClases,
  enviarCorreoAdmin,
  actualizarCaso,
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
  obtenerAsistenciasPrimeraClase,
  registrarAsistenciaPrimeraClase,
  registrarEnvio,
  sirveParaCorreo,
  sirveParaWhatsApp,
  type CanalEnvio,
  type EnvioPlantilla,
  type Firma,
  type PlantillaClasePrueba,
} from '../lib/crm/admin-mensajes-api.ts';
import { etiquetaDia, HORA_CLASE_PRUEBA, type DiaClasePrueba } from '../lib/crm/clase-prueba.ts';
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
  asistenciasPrimeraClase: Set<string>;
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
  const siguiente = ctx.plantillas.find((p) => !ctx.envios.some((e) => e.caso_id === caso.id && e.plantilla_id === p.id));
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

  const datosPlantilla = (linkPago: string | null) => ({
    nombre_apoderado: primerNombre(caso.atleta.apoderado.nombre),
    nombre_atleta: primerNombre(caso.atleta.nombre),
    remitente: ctx.firma.nombre,
    cargo: cargoEnMensaje(ctx.firma.cargo),
    fecha_clase: fechaClaseTexto(item.fecha),
    hora_clase: horaClase(caso),
    talla: ctx.tallas.get(caso.atleta.id) ?? null,
    valor_inscripcion: ctx.valorInscripcion,
    link_pago: linkPago,
  });

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

  const correoDe = (plantilla: PlantillaClasePrueba, linkPago: string | null) =>
    renderizarCorreo({
      asunto: plantilla.asunto?.trim() || plantilla.nombre,
      cuerpo: plantilla.cuerpo_email?.trim() || plantilla.cuerpo,
      datos: datosPlantilla(linkPago),
      clase: { etiqueta: esStar(caso) ? 'Tu primera clase' : 'Tu clase de prueba', horaFin: horaFinClase(caso) },
    });

  botonCorreo.addEventListener('click', async () => {
    aviso.hidden = true;
    aviso.classList.remove('cp-mensajes__aviso--ok');
    const plantilla = ctx.plantillas.find((p) => p.id === selectPlantilla.value);
    if (!plantilla || !email) return;
    const textos = `${plantilla.asunto ?? ''}\n${plantilla.cuerpo_email ?? plantilla.cuerpo}`;
    const necesitaLink = variablesUsadas(textos).includes('link_pago');

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

const ESTADO_PAGO_STAR: Record<string, { texto: string; clase: string }> = {
  INSCRITO: { texto: 'Kit pagado', clase: 'cp-pago--ok' },
  NUEVO: { texto: 'Kit pendiente de pago', clase: 'cp-pago--pendiente' },
};

function marcarAsistio(accion: HTMLElement, fila: HTMLElement): void {
  fila.classList.add('cp-fila--asistio');
  accion.innerHTML = '<span class="cp-fila__confirmado">✓ Asistió</span>';
}

function filaCaso(item: ItemPrimeraClase, supabase: SupabaseClient, ctx: ContextoMensajes): HTMLElement {
  const caso = item.caso;
  const esInscripcion = item.tipo === 'INSCRIPCION';
  const fila = document.createElement('div');
  const yaAsistio = esInscripcion ? ctx.asistenciasPrimeraClase.has(caso.id) : caso.estado === CRM_ESTADOS.ASISTIO;
  fila.className = `cp-fila${yaAsistio ? ' cp-fila--asistio' : ''}`;

  const info = document.createElement('div');
  info.className = 'cp-fila__info';
  const dia = !esStar(caso) && caso.dia_clase_prueba ? etiquetaDia(caso.dia_clase_prueba as DiaClasePrueba) : '';
  const etiqueta = esInscripcion
    ? '<span class="cp-etiqueta-star">Inscripción Star</span>'
    : esStar(caso)
      ? '<span class="cp-etiqueta-star">Prueba Star</span>'
      : '<span class="cp-etiqueta-general">Prueba</span>';
  const pago = esInscripcion ? ESTADO_PAGO_STAR[caso.estado] : undefined;
  info.innerHTML = `
    <p class="cp-fila__nombre">${escaparHtml(`${caso.atleta.nombre} ${caso.atleta.apellidos}`)} ${etiqueta}${
      pago ? ` <span class="cp-pago ${pago.clase}">${pago.texto}</span>` : ''
    }</p>
    <p class="cp-fila__detalle">${escaparHtml(`${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}`)} · ${escaparHtml(
      caso.atleta.apoderado.telefono,
    )}${dia ? ` · ${escaparHtml(dia)}` : ''}${horaClase(caso) ? ` · ${escaparHtml(horaClase(caso)!)}` : ''}</p>
    ${caso.comentario_inicial ? `<p class="cp-fila__nota">📝 ${escaparHtml(caso.comentario_inicial)}</p>` : ''}
  `;

  const accion = document.createElement('div');
  accion.className = 'cp-fila__accion';

  if (yaAsistio) {
    accion.innerHTML = '<span class="cp-fila__confirmado">✓ Asistió</span>';
  } else {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'admin-btn admin-btn--secundario';
    boton.textContent = '✓ Marcar asistencia';
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        // En una inscripción Star el estado refleja el pago, así que la asistencia
        // se registra como nota y el estado no cambia.
        if (esInscripcion) {
          await registrarAsistenciaPrimeraClase(supabase, caso.id);
          ctx.asistenciasPrimeraClase.add(caso.id);
        } else {
          await actualizarCaso(supabase, caso.id, { estado: CRM_ESTADOS.ASISTIO });
        }
        marcarAsistio(accion, fila);
      } catch (err) {
        mostrarError(mensajeErrorSupabase(err, 'No pudimos marcar la asistencia. Inténtalo nuevamente.'));
        boton.disabled = false;
      }
    });
    accion.appendChild(boton);
  }

  fila.append(info, accion);
  if (ctx.activo && ctx.plantillas.length > 0) fila.appendChild(bloqueMensajes(item, supabase, ctx));
  return fila;
}

async function cargarContexto(supabase: SupabaseClient, casos: CasoResumen[]): Promise<ContextoMensajes> {
  const vacio: ContextoMensajes = {
    activo: false,
    firma: { nombre: null, cargo: null, nombreFirma: null, disponible: false },
    plantillas: [],
    envios: [],
    tallas: new Map(),
    valorInscripcion: null,
    asistenciasPrimeraClase: new Set(),
  };
  try {
    const [firma, plantillas, envios, tallas, valorInscripcion, asistenciasPrimeraClase] = await Promise.all([
      obtenerFirma(supabase),
      obtenerPlantillasClasePrueba(supabase),
      obtenerEnvios(supabase, casos.map((c) => c.id)),
      obtenerTallas(supabase, casos.map((c) => c.atleta.id)),
      obtenerValorInscripcionStar(supabase),
      obtenerAsistenciasPrimeraClase(supabase, casos.map((c) => c.id)),
    ]);
    if (!firma.disponible) return { ...vacio, asistenciasPrimeraClase };
    return { activo: true, firma, plantillas, envios, tallas, valorInscripcion, asistenciasPrimeraClase };
  } catch {
    return vacio;
  }
}

let PROGRAMA: SeleccionPrograma = 'TODOS';

async function renderizarLista(supabase: SupabaseClient): Promise<void> {
  let casos: CasoResumen[];
  try {
    casos = await obtenerCasos(supabase);
  } catch (err) {
    mostrarError(mensajeErrorSupabase(err, 'No pudimos cargar la lista. Recarga la página o inténtalo más tarde.'));
    return;
  }

  await cargarConfiguracion(supabase);
  const todos = agruparPrimerasClases(casos, new Date(), CONFIG.starPrimeraClase);
  const itemsTodos = todos.flatMap((g) => g.items);
  const ctx = await cargarContexto(supabase, itemsTodos.map((i) => i.caso));

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
    const grupos = todos
      .map((g) => ({ fecha: g.fecha, items: g.items.filter((i) => coincidePrograma(i.caso.programa, PROGRAMA)) }))
      .filter((g) => g.items.length > 0);

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
      const pruebas = grupo.items.filter((i) => i.tipo === 'PRUEBA').length;
      const inscripciones = grupo.items.length - pruebas;
      const partes = [
        pruebas ? `${pruebas} clase${pruebas === 1 ? '' : 's'} de prueba` : '',
        inscripciones ? `${inscripciones} inscripci${inscripciones === 1 ? 'ón' : 'ones'} Star` : '',
      ].filter(Boolean);
      titulo.textContent = `${tituloGrupo(grupo.fecha)} · ${partes.join(' y ')}`;
      seccion.appendChild(titulo);
      grupo.items.forEach((i) => seccion.appendChild(filaCaso(i, supabase, ctx)));
      contenedor.appendChild(seccion);
    });
  };

  montarSelectorPrograma($<HTMLElement>('#cp-programa')!, conteo, PROGRAMA, (v) => {
    PROGRAMA = v;
    dibujar();
  });
  dibujar();
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
  await renderizarLista(supabase);
}
