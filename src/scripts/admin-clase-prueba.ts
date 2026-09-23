import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerCasos,
  agruparClasePruebaPorFecha,
  actualizarCaso,
  registrarVisitaRapida,
  validarDatosVisitaRapida,
  type CasoResumen,
} from '../lib/crm/admin-api.ts';
import {
  guardarTalla,
  obtenerEnvios,
  obtenerFirma,
  obtenerPlantillasClasePrueba,
  obtenerTallas,
  obtenerValorInscripcionStar,
  registrarEnvio,
  type EnvioPlantilla,
  type Firma,
  type PlantillaClasePrueba,
} from '../lib/crm/admin-mensajes-api.ts';
import { etiquetaDia, HORA_CLASE_PRUEBA, type DiaClasePrueba } from '../lib/crm/clase-prueba.ts';
import { CRM_ESTADOS, CRM_JOURNEYS } from '../lib/crm/constants.ts';
import { mensajeErrorSupabase, escaparHtml } from '../lib/crm/format.ts';
import {
  completarPlantilla,
  enlaceWhatsApp,
  fechaClaseTexto,
  mensajeFaltantes,
  primerNombre,
  TALLAS_POLERA,
} from '../lib/crm/plantillas.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Datos para los mensajes con plantilla. Si la migración 0009 falta, `activo` es false. */
interface ContextoMensajes {
  activo: boolean;
  firma: Firma;
  plantillas: PlantillaClasePrueba[];
  envios: EnvioPlantilla[];
  tallas: Map<string, string | null>;
  valorInscripcion: string | null;
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
      return `<span class="cp-enviado">✓ ${escaparHtml(p?.nombre ?? 'Plantilla')} · ${fechaCorta(e.fecha)}</span>`;
    })
    .join('');
}

function bloqueMensajes(caso: CasoResumen, supabase: SupabaseClient, ctx: ContextoMensajes): HTMLElement {
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
          ${TALLAS_POLERA.map((t) => `<option value="${t}" ${t === tallaActual ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="cp-mensajes__plantilla">
        <label class="admin-label" for="${idPlantilla}">Mensaje</label>
        <select id="${idPlantilla}" class="admin-select">
          ${ctx.plantillas.map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="admin-btn admin-btn--whatsapp cp-btn-enviar">Enviar por WhatsApp</button>
    </div>
    <p class="cp-mensajes__aviso" hidden></p>
    <div class="cp-enviados"></div>`;

  const selectTalla = bloque.querySelector<HTMLSelectElement>(`#${CSS.escape(idTalla)}`)!;
  const selectPlantilla = bloque.querySelector<HTMLSelectElement>(`#${CSS.escape(idPlantilla)}`)!;
  const boton = bloque.querySelector<HTMLButtonElement>('.cp-btn-enviar')!;
  const aviso = bloque.querySelector<HTMLElement>('.cp-mensajes__aviso')!;
  const enviados = bloque.querySelector<HTMLElement>('.cp-enviados')!;
  renderEnviados(enviados, caso, ctx);

  // Sugiere el primer mensaje que aún no se envía.
  const siguiente = ctx.plantillas.find((p) => !ctx.envios.some((e) => e.caso_id === caso.id && e.plantilla_id === p.id));
  if (siguiente) selectPlantilla.value = siguiente.id;

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

  boton.addEventListener('click', () => {
    aviso.hidden = true;
    const plantilla = ctx.plantillas.find((p) => p.id === selectPlantilla.value);
    if (!plantilla) return;
    const dia = caso.dia_clase_prueba as DiaClasePrueba | null;
    const { texto, faltantes } = completarPlantilla(plantilla.cuerpo, {
      nombre_apoderado: primerNombre(caso.atleta.apoderado.nombre),
      nombre_atleta: primerNombre(caso.atleta.nombre),
      remitente: ctx.firma.nombre,
      cargo: ctx.firma.cargo,
      fecha_clase: fechaClaseTexto(caso.fecha_clase_prueba),
      hora_clase: dia ? HORA_CLASE_PRUEBA[dia] : null,
      talla: ctx.tallas.get(caso.atleta.id) ?? null,
      valor_inscripcion: ctx.valorInscripcion,
      link_pago: null, // disponible con la página de pago (etapa C)
    });
    if (faltantes.length > 0) {
      aviso.textContent = mensajeFaltantes(faltantes);
      aviso.hidden = false;
      return;
    }
    // Se abre WhatsApp antes de cualquier espera, para que el navegador no lo bloquee.
    window.open(enlaceWhatsApp(caso.atleta.apoderado.telefono, texto), '_blank', 'noopener');
    registrarEnvio(supabase, caso.id, plantilla)
      .then(() => {
        ctx.envios.push({ caso_id: caso.id, plantilla_id: plantilla.id, fecha: new Date().toISOString() });
        renderEnviados(enviados, caso, ctx);
        const proxima = ctx.plantillas.find((p) => !ctx.envios.some((e) => e.caso_id === caso.id && e.plantilla_id === p.id));
        if (proxima) selectPlantilla.value = proxima.id;
      })
      .catch((err) => {
        aviso.textContent = mensajeErrorSupabase(err, 'El mensaje se abrió en WhatsApp, pero no pudimos registrar el envío.');
        aviso.hidden = false;
      });
  });

  return bloque;
}

function filaCaso(caso: CasoResumen, supabase: SupabaseClient, ctx: ContextoMensajes): HTMLElement {
  const fila = document.createElement('div');
  const yaAsistio = caso.estado === CRM_ESTADOS.ASISTIO;
  fila.className = `cp-fila${yaAsistio ? ' cp-fila--asistio' : ''}`;

  const info = document.createElement('div');
  info.className = 'cp-fila__info';
  const dia = caso.dia_clase_prueba ? etiquetaDia(caso.dia_clase_prueba as DiaClasePrueba) : '';
  const esStar = caso.journey === CRM_JOURNEYS.CLASE_PRUEBA_STAR;
  info.innerHTML = `
    <p class="cp-fila__nombre">${escaparHtml(`${caso.atleta.nombre} ${caso.atleta.apellidos}`)}${
      esStar ? ' <span class="cp-etiqueta-star">Star</span>' : ''
    }</p>
    <p class="cp-fila__detalle">${escaparHtml(`${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}`)} · ${escaparHtml(
      caso.atleta.apoderado.telefono,
    )}${dia ? ` · ${escaparHtml(dia)}` : ''}</p>
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
  if (ctx.activo && ctx.plantillas.length > 0) fila.appendChild(bloqueMensajes(caso, supabase, ctx));
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

async function renderizarLista(supabase: SupabaseClient): Promise<void> {
  let casos: CasoResumen[];
  try {
    casos = await obtenerCasos(supabase);
  } catch (err) {
    mostrarError(mensajeErrorSupabase(err, 'No pudimos cargar la lista. Recarga la página o inténtalo más tarde.'));
    return;
  }

  const grupos = agruparClasePruebaPorFecha(casos);
  const ctx = await cargarContexto(supabase, grupos.flatMap((g) => g.casos));

  $('#cp-cargando')?.setAttribute('hidden', '');
  const avisoMensajes = $<HTMLElement>('#cp-aviso-mensajes')!;
  avisoMensajes.hidden = ctx.activo;
  if (!ctx.activo) {
    avisoMensajes.textContent = 'Los mensajes con plantilla estarán disponibles después de ejecutar la migración 0009 en Supabase.';
  }

  const vacio = $<HTMLElement>('#cp-vacio')!;
  const contenedor = $<HTMLElement>('#cp-grupos')!;
  contenedor.innerHTML = '';

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
    titulo.textContent = `${tituloGrupo(grupo.fecha)} · ${grupo.casos.length} inscrito${grupo.casos.length === 1 ? '' : 's'}`;
    seccion.appendChild(titulo);
    grupo.casos.forEach((c) => seccion.appendChild(filaCaso(c, supabase, ctx)));
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

  conectarVisitaRapida(supabase);
  await renderizarLista(supabase);
}
