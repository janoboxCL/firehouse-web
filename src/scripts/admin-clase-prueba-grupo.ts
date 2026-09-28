// Envío de un correo con plantilla a todo el grupo de una fecha (Clase de prueba).
// Se revisa y previsualiza antes de enviar; los correos salen de a uno, con una
// pausa corta entre cada uno, y cada envío queda registrado en su caso.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarCorreoAdmin, type ItemPrimeraClase, type CasoResumen } from '../lib/crm/admin-api.ts';
import { registrarEnvio, type EnvioPlantilla, type PlantillaClasePrueba } from '../lib/crm/admin-mensajes-api.ts';
import { generarLinkPago } from '../lib/crm/admin-cuenta-api.ts';
import type { CorreoRenderizado } from '../lib/crm/correo-plantilla.ts';
import {
  PAUSA_ENTRE_CORREOS_MS,
  correosCompartidos,
  estadoCandidato,
  lineasResumen,
  type Candidato,
  type ResultadoEnvio,
} from '../lib/crm/envio-grupal.ts';
import { escaparHtml } from '../lib/crm/format.ts';
import { mensajeFaltantes, primerNombre } from '../lib/crm/plantillas.ts';

export interface OpcionesEnvioGrupal {
  supabase: SupabaseClient;
  titulo: string;
  items: ItemPrimeraClase[];
  plantillas: PlantillaClasePrueba[];
  envios: EnvioPlantilla[];
  correoPara: (item: ItemPrimeraClase, plantilla: PlantillaClasePrueba, link: string | null, avisoInterno?: string[]) => CorreoRenderizado;
  necesitaLink: (plantilla: PlantillaClasePrueba) => boolean;
  bloqueo: (caso: CasoResumen, plantilla: PlantillaClasePrueba) => string | null;
  alTerminar: () => Promise<void>;
}

/** Link de ejemplo para la vista previa: el real se crea para cada familia al enviar. */
const LINK_EJEMPLO = 'https://firehousecheer.cl/pagar';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

let op: OpcionesEnvioGrupal;
let plantilla: PlantillaClasePrueba;
let candidatos: Array<{ item: ItemPrimeraClase; c: Candidato }> = [];
let seleccion = new Set<string>();
let enPrevia: string | null = null;
let enviando = false;
let huboEnvios = false;
let conectado = false;

function candidatoDe(item: ItemPrimeraClase, p: PlantillaClasePrueba): Candidato {
  const caso = item.caso;
  const previo = op.envios
    .filter((e) => e.caso_id === caso.id && e.plantilla_id === p.id && e.tipo === 'EMAIL')
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  const previa = op.correoPara(item, p, op.necesitaLink(p) ? LINK_EJEMPLO : null);
  return {
    casoId: caso.id,
    nombreAtleta: primerNombre(caso.atleta.nombre),
    nombreApoderado: `${caso.atleta.apoderado.nombre} ${caso.atleta.apoderado.apellidos}`.trim(),
    email: caso.atleta.apoderado.email?.trim() || null,
    yaEnviado: previo?.fecha ?? null,
    bloqueo: op.bloqueo(caso, p) ? 'Ya pagó la inscripción: este mensaje no le corresponde' : null,
    faltantes: previa.faltantes.length ? mensajeFaltantes(previa.faltantes) : null,
  };
}

function prepararCandidatos(): void {
  candidatos = op.items.map((item) => ({ item, c: candidatoDe(item, plantilla) }));
  seleccion = new Set(candidatos.filter(({ c }) => estadoCandidato(c, fechaCorta).seleccionado).map(({ c }) => c.casoId));
  enPrevia = [...seleccion][0] ?? candidatos.find(({ c }) => estadoCandidato(c, fechaCorta).enviable)?.c.casoId ?? candidatos[0]?.c.casoId ?? null;
}

function dibujarLista(resultados?: Map<string, ResultadoEnvio>): void {
  const compartidos = correosCompartidos(candidatos.map(({ c }) => c));
  $<HTMLElement>('#cp-grupo-lista').innerHTML = candidatos
    .map(({ c }) => {
      const e = estadoCandidato(c, fechaCorta);
      const r = resultados?.get(c.casoId);
      const notas = [e.nota, compartidos.get(c.casoId)].filter(Boolean) as string[];
      const resultado = r ? (r.ok ? '<span class="cp-grupo__ok">✓ Enviado</span>' : `<span class="cp-grupo__error">✗ ${escaparHtml(r.error ?? 'Error')}</span>`) : '';
      return `<li class="cp-grupo__item${c.casoId === enPrevia ? ' cp-grupo__item--previa' : ''}${e.enviable ? '' : ' cp-grupo__item--no'}">
        <label class="cp-grupo__check">
          <input type="checkbox" value="${escaparHtml(c.casoId)}" ${seleccion.has(c.casoId) ? 'checked' : ''} ${e.enviable && !enviando ? '' : 'disabled'} />
          <span><strong>${escaparHtml(c.nombreAtleta)}</strong> · ${escaparHtml(c.nombreApoderado)}<br><small>${escaparHtml(c.email ?? 'sin correo')}</small>
          ${notas.map((n) => `<small class="cp-grupo__nota">${escaparHtml(n)}</small>`).join('')}</span>
        </label>
        <span class="cp-grupo__lado">${resultado}<button type="button" class="cp-link-fecha" data-previa="${escaparHtml(c.casoId)}">Ver</button></span>
      </li>`;
    })
    .join('');
  actualizarBoton();
}

function dibujarPrevia(): void {
  const par = candidatos.find(({ c }) => c.casoId === enPrevia);
  if (!par) return;
  const correo = op.correoPara(par.item, plantilla, op.necesitaLink(plantilla) ? LINK_EJEMPLO : null);
  $<HTMLElement>('#cp-grupo-previa-para').textContent = `${par.c.nombreAtleta} · ${par.c.email ?? 'sin correo'}`;
  $<HTMLElement>('#cp-grupo-previa-asunto').textContent = correo.asunto;
  $<HTMLIFrameElement>('#cp-grupo-previa').srcdoc = correo.html;
  $<HTMLElement>('#cp-grupo-previa-link').hidden = !op.necesitaLink(plantilla);
}

function actualizarBoton(): void {
  const n = seleccion.size;
  const boton = $<HTMLButtonElement>('#cp-grupo-enviar');
  boton.disabled = n === 0 || enviando;
  boton.textContent = enviando ? 'Enviando…' : n ? `Enviar a ${n} ${n === 1 ? 'familia' : 'familias'}` : 'Selecciona familias';
}

function bloquearControles(si: boolean): void {
  enviando = si;
  $<HTMLSelectElement>('#cp-grupo-plantilla').disabled = si;
  $<HTMLInputElement>('#cp-grupo-copia').disabled = si;
  $<HTMLButtonElement>('#cp-grupo-cerrar').disabled = si;
  document.querySelectorAll<HTMLButtonElement>('#cp-grupo-todos, #cp-grupo-ninguno').forEach((b) => (b.disabled = si));
}

async function enviar(): Promise<void> {
  const elegidos = candidatos.filter(({ c }) => seleccion.has(c.casoId));
  if (!elegidos.length) return;
  if (!window.confirm(`¿Enviar "${plantilla.nombre}" por correo a ${elegidos.length} ${elegidos.length === 1 ? 'familia' : 'familias'}?`)) return;

  bloquearControles(true);
  huboEnvios = true;
  const progreso = $<HTMLElement>('#cp-grupo-progreso');
  const barra = $<HTMLProgressElement>('#cp-grupo-barra');
  const texto = $<HTMLElement>('#cp-grupo-progreso-texto');
  progreso.hidden = false;
  barra.max = elegidos.length;
  const resultados = new Map<string, ResultadoEnvio>();
  let primero: { item: ItemPrimeraClase; link: string | null } | null = null;

  for (let i = 0; i < elegidos.length; i++) {
    const { item, c } = elegidos[i];
    barra.value = i;
    texto.textContent = `Enviando ${i + 1} de ${elegidos.length}: ${c.nombreAtleta} (${c.email})`;
    const base = { nombreAtleta: c.nombreAtleta, nombreApoderado: c.nombreApoderado, email: c.email ?? '' };
    try {
      // El link de pago se crea solo al enviar (prepara los cargos Star de esa familia).
      const link = op.necesitaLink(plantilla) ? (await generarLinkPago(op.supabase, { atletaId: item.caso.atleta.id })).url : null;
      const correo = op.correoPara(item, plantilla, link);
      if (correo.faltantes.length) throw new Error(mensajeFaltantes(correo.faltantes));
      await enviarCorreoAdmin(op.supabase, c.email!, correo.asunto, correo.html, correo.texto, { sinCopia: true });
      resultados.set(c.casoId, { ...base, ok: true });
      seleccion.delete(c.casoId);
      primero ??= { item, link };
      try {
        await registrarEnvio(op.supabase, c.casoId, plantilla, 'EMAIL');
        op.envios.push({ caso_id: c.casoId, plantilla_id: plantilla.id, fecha: new Date().toISOString(), tipo: 'EMAIL' });
      } catch {
        /* el correo salió; si falla el registro, se ve en el resumen como enviado igual */
      }
    } catch (err) {
      resultados.set(c.casoId, { ...base, ok: false, error: err instanceof Error ? err.message : 'No se pudo enviar' });
    }
    dibujarLista(resultados);
    if (i < elegidos.length - 1) await pausa(PAUSA_ENTRE_CORREOS_MS);
  }
  barra.value = elegidos.length;

  const lista = [...resultados.values()];
  const ok = lista.filter((r) => r.ok).length;
  const fallidos = lista.length - ok;
  let copia = '';
  if ($<HTMLInputElement>('#cp-grupo-copia').checked && primero) {
    const omitidos = candidatos
      .filter(({ c }) => !resultados.has(c.casoId))
      .map(({ c }) => ({ nombreAtleta: c.nombreAtleta, motivo: estadoCandidato(c, fechaCorta).nota ?? 'No seleccionado' }));
    const aviso = [`${plantilla.nombre} · ${op.titulo}`, ...lineasResumen(lista, omitidos)];
    const correo = op.correoPara(primero.item, plantilla, primero.link, aviso);
    try {
      const yo = (await op.supabase.auth.getSession()).data.session?.user.email ?? 'copia@firehousecheer.cl';
      await enviarCorreoAdmin(op.supabase, yo, `[Copia] ${correo.asunto} · ${ok} ${ok === 1 ? 'familia' : 'familias'}`, correo.html, correo.texto, {
        copiaInterna: true,
      });
      copia = ' Se envió la copia con el resumen.';
    } catch {
      copia = ' No se pudo enviar la copia con el resumen.';
    }
  }

  texto.textContent = `Listo: ${ok} ${ok === 1 ? 'correo enviado' : 'correos enviados'}${fallidos ? `, ${fallidos} con error (quedaron marcados para reintentar)` : ''}.${copia}`;
  // Los que fallaron siguen seleccionados: basta con volver a presionar Enviar.
  bloquearControles(false);
  dibujarLista(resultados);
}

function conectar(): void {
  if (conectado) return;
  conectado = true;
  const dialogo = $<HTMLDialogElement>('#cp-dialogo-grupo');
  dialogo.addEventListener('cancel', (e) => {
    if (enviando) e.preventDefault();
  });
  dialogo.addEventListener('close', () => {
    if (huboEnvios) void op.alTerminar();
  });
  $('#cp-grupo-cerrar').addEventListener('click', () => {
    if (!enviando) dialogo.close();
  });
  $('#cp-grupo-plantilla').addEventListener('change', (e) => {
    plantilla = op.plantillas.find((p) => p.id === (e.target as HTMLSelectElement).value) ?? plantilla;
    prepararCandidatos();
    dibujarLista();
    dibujarPrevia();
  });
  $('#cp-grupo-lista').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    if (input.checked) seleccion.add(input.value);
    else seleccion.delete(input.value);
    actualizarBoton();
  });
  $('#cp-grupo-lista').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-previa]');
    if (!b) return;
    enPrevia = b.dataset.previa ?? null;
    dibujarLista();
    dibujarPrevia();
  });
  $('#cp-grupo-todos').addEventListener('click', () => {
    candidatos.forEach(({ c }) => estadoCandidato(c, fechaCorta).enviable && seleccion.add(c.casoId));
    dibujarLista();
  });
  $('#cp-grupo-ninguno').addEventListener('click', () => {
    seleccion.clear();
    dibujarLista();
  });
  $('#cp-grupo-enviar').addEventListener('click', () => void enviar());
}

export function abrirEnvioGrupal(opciones: OpcionesEnvioGrupal): void {
  op = opciones;
  huboEnvios = false;
  conectar();
  // Sugiere el primer mensaje que alguna familia del grupo aún no recibe por correo.
  plantilla =
    op.plantillas.find((p) => op.items.some((i) => !op.envios.some((e) => e.caso_id === i.caso.id && e.plantilla_id === p.id && e.tipo === 'EMAIL'))) ??
    op.plantillas[0];
  $<HTMLElement>('#cp-grupo-titulo').textContent = `Enviar correo · ${op.titulo}`;
  $<HTMLSelectElement>('#cp-grupo-plantilla').innerHTML = op.plantillas
    .map((p) => `<option value="${escaparHtml(p.id)}" ${p.id === plantilla.id ? 'selected' : ''}>${escaparHtml(p.nombre)}</option>`)
    .join('');
  $<HTMLElement>('#cp-grupo-progreso').hidden = true;
  $<HTMLInputElement>('#cp-grupo-copia').checked = true;
  prepararCandidatos();
  dibujarLista();
  dibujarPrevia();
  $<HTMLDialogElement>('#cp-dialogo-grupo').showModal();
}
