// Secciones "Inscripciones hoy", "Precios" y "Periodos de inscripción" de
// /admin/configuracion. Requiere la migración 0007; si falta, muestra un aviso
// y no afecta al resto de la página.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  actualizarPeriodo,
  crearPeriodo,
  eliminarPeriodo,
  guardarPrecios,
  MigracionPendienteError,
  obtenerConfigProgramas,
  type ConfigProgramas,
  type PrecioHermanos,
  type PrecioPrograma,
} from '../lib/crm/admin-programas-api.ts';
import {
  COMBINACIONES_HERMANOS,
  COMBINACIONES_LABEL,
  ESTADO_PERIODO_LABEL,
  estadoInscripcionPrograma,
  estadoPeriodo,
  formatoPesos,
  hoyChile,
  parsearMonto,
  periodosSolapados,
  PROGRAMAS_LABEL,
  validarPeriodo,
  type EstadoPeriodo,
  type PeriodoInscripcion,
  type Programa,
} from '../lib/crm/programas.ts';

type PeriodoConId = PeriodoInscripcion & { id: string };

function $<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Falta el elemento ${selector}`);
  return el;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fechaLarga(iso: string | null): string {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const CLASE_BADGE: Record<EstadoPeriodo, string> = {
  ABIERTO: 'admin-badge--estado-cerrado-ok',
  PROXIMO: 'admin-badge--estado-abierto',
  FINALIZADO: 'admin-badge--estado-cerrado-no',
  INACTIVO: 'admin-badge--estado-cerrado-no',
};

let supabase: SupabaseClient;
let config: ConfigProgramas;
let temporada: number;
/** Temporadas creadas en pantalla que aún no se guardan. */
const temporadasNuevas = new Set<number>();
let editandoId: string | null = null;

function programasOrdenados(): Programa[] {
  return config.programas.map((p) => p.codigo);
}

function nombrePrograma(codigo: Programa): string {
  return config.programas.find((p) => p.codigo === codigo)?.nombre ?? PROGRAMAS_LABEL[codigo];
}

function temporadasDisponibles(): number[] {
  const set = new Set<number>([
    ...config.precios.map((p) => p.temporada),
    ...config.hermanos.map((h) => h.temporada),
    ...temporadasNuevas,
  ]);
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Inscripciones hoy
// ---------------------------------------------------------------------------

function renderEstado(): void {
  const hoy = hoyChile();
  $<HTMLElement>('#prg-estado-lista').innerHTML = programasOrdenados()
    .map((codigo) => {
      const e = estadoInscripcionPrograma(config.periodos, codigo, hoy);
      let detalle: string;
      if (e.abierta && e.periodoActual) {
        detalle = e.periodoActual.cierra
          ? `Periodo "${esc(e.periodoActual.nombre)}", cierra el ${fechaLarga(e.periodoActual.cierra)}.`
          : `Periodo "${esc(e.periodoActual.nombre)}", sin fecha de cierre.`;
      } else if (e.proximo) {
        detalle = `Próximo periodo: "${esc(e.proximo.nombre)}", abre el ${fechaLarga(e.proximo.abre)}.`;
      } else {
        detalle = 'No hay periodos futuros definidos.';
      }
      return `
        <div class="prg-estado__item">
          <p class="prg-estado__programa">${esc(nombrePrograma(codigo))}</p>
          <span class="admin-badge ${e.abierta ? 'admin-badge--estado-cerrado-ok' : 'admin-badge--vencido'}">${
            e.abierta ? 'Inscripciones abiertas' : 'Inscripciones cerradas'
          }</span>
          <p class="prg-estado__detalle">${detalle}</p>
        </div>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

/** Temporada de la que se toman los valores: la misma, o la anterior más cercana si es nueva. */
function temporadaOrigen(t: number, lista: Array<{ temporada: number }>): number | null {
  if (lista.some((x) => x.temporada === t)) return t;
  const anteriores = lista.map((x) => x.temporada).filter((x) => x < t);
  if (anteriores.length) return Math.max(...anteriores);
  return lista.length ? Math.max(...lista.map((x) => x.temporada)) : null;
}

function valoresBase(t: number): { precios: PrecioPrograma[]; hermanos: PrecioHermanos[] } {
  const origen = temporadaOrigen(t, config.precios);
  const precios = programasOrdenados().map((codigo) => {
    const p = config.precios.find((x) => x.programa_codigo === codigo && x.temporada === origen);
    return { programa_codigo: codigo, temporada: t, matricula: p?.matricula ?? 0, mensualidad: p?.mensualidad ?? 0 };
  });
  const origenH = temporadaOrigen(t, config.hermanos);
  const hermanos = COMBINACIONES_HERMANOS.map((combinacion) => {
    const h = config.hermanos.find((x) => x.combinacion === combinacion && x.temporada === origenH);
    return { temporada: t, combinacion, monto_total: h?.monto_total ?? 0 };
  });
  return { precios, hermanos };
}

function renderSelectorTemporada(): void {
  $<HTMLSelectElement>('#prg-temporada').innerHTML = temporadasDisponibles()
    .map((t) => `<option value="${t}" ${t === temporada ? 'selected' : ''}>${t}${temporadasNuevas.has(t) ? ' (sin guardar)' : ''}</option>`)
    .join('');
}

function actualizarPorDeportista(input: HTMLInputElement): void {
  const celda = input.closest('tr')?.querySelector<HTMLElement>('[data-por-deportista]');
  if (!celda) return;
  const monto = parsearMonto(input.value);
  celda.textContent = monto === null ? 'Monto no válido' : formatoPesos(Math.round(monto / 2));
}

function renderPrecios(): void {
  renderSelectorTemporada();
  const { precios, hermanos } = valoresBase(temporada);

  $<HTMLElement>('#prg-filas-precios').innerHTML = precios
    .map(
      (p) => `
      <tr>
        <td>${esc(nombrePrograma(p.programa_codigo))}</td>
        <td><input class="admin-input prg-monto" inputmode="numeric" aria-label="Matrícula ${esc(nombrePrograma(p.programa_codigo))}"
             data-programa="${p.programa_codigo}" data-campo="matricula" value="${p.matricula.toLocaleString('es-CL')}" /></td>
        <td><input class="admin-input prg-monto" inputmode="numeric" aria-label="Mensualidad ${esc(nombrePrograma(p.programa_codigo))}"
             data-programa="${p.programa_codigo}" data-campo="mensualidad" value="${p.mensualidad.toLocaleString('es-CL')}" /></td>
      </tr>`,
    )
    .join('');

  $<HTMLElement>('#prg-filas-hermanos').innerHTML = hermanos
    .map(
      (h) => `
      <tr>
        <td>${esc(COMBINACIONES_LABEL[h.combinacion])}</td>
        <td><input class="admin-input prg-monto" inputmode="numeric" aria-label="Total mensual ${esc(COMBINACIONES_LABEL[h.combinacion])}"
             data-combinacion="${h.combinacion}" value="${h.monto_total.toLocaleString('es-CL')}" /></td>
        <td data-por-deportista>${formatoPesos(Math.round(h.monto_total / 2))}</td>
      </tr>`,
    )
    .join('');

  document.querySelectorAll<HTMLInputElement>('#prg-filas-hermanos input').forEach((i) => {
    i.addEventListener('input', () => actualizarPorDeportista(i));
  });
}

async function onGuardarPrecios(evt: Event): Promise<void> {
  evt.preventDefault();
  const error = $<HTMLElement>('#prg-precios-error');
  const guardado = $<HTMLElement>('#prg-precios-guardado');
  error.hidden = true;
  guardado.hidden = true;

  const precios: PrecioPrograma[] = [];
  for (const codigo of programasOrdenados()) {
    const mat = parsearMonto($<HTMLInputElement>(`[data-programa="${codigo}"][data-campo="matricula"]`).value);
    const men = parsearMonto($<HTMLInputElement>(`[data-programa="${codigo}"][data-campo="mensualidad"]`).value);
    if (mat === null || men === null) {
      error.textContent = `Revisa los montos de ${nombrePrograma(codigo)}: usa solo números enteros, sin decimales.`;
      error.hidden = false;
      return;
    }
    precios.push({ programa_codigo: codigo, temporada, matricula: mat, mensualidad: men });
  }

  const hermanos: PrecioHermanos[] = [];
  for (const combinacion of COMBINACIONES_HERMANOS) {
    const monto = parsearMonto($<HTMLInputElement>(`[data-combinacion="${combinacion}"]`).value);
    if (monto === null || monto <= 0) {
      error.textContent = `Revisa el precio de "${COMBINACIONES_LABEL[combinacion]}": debe ser mayor que cero.`;
      error.hidden = false;
      return;
    }
    hermanos.push({ temporada, combinacion, monto_total: monto });
  }

  try {
    await guardarPrecios(supabase, precios, hermanos);
    temporadasNuevas.delete(temporada);
    config = await obtenerConfigProgramas(supabase);
    renderPrecios();
    guardado.hidden = false;
    setTimeout(() => (guardado.hidden = true), 2500);
  } catch {
    error.textContent = 'No se pudieron guardar los precios. Revisa tu conexión e inténtalo nuevamente.';
    error.hidden = false;
  }
}

function onNuevaTemporada(): void {
  const siguiente = Math.max(...temporadasDisponibles(), new Date().getFullYear()) + 1;
  temporadasNuevas.add(siguiente);
  temporada = siguiente;
  renderPrecios();
}

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------

function renderPeriodos(): void {
  const hoy = hoyChile();
  const periodos = config.periodos as PeriodoConId[];

  const solapes = periodosSolapados(periodos);
  $<HTMLElement>('#prg-solapes').innerHTML = solapes
    .map(
      ([a, b]) =>
        `<div class="admin-aviso-cerrado">Los periodos "${esc(a.nombre)}" y "${esc(b.nombre)}" de ${esc(
          nombrePrograma(a.programa_codigo),
        )} se superponen. Revisa sus fechas.</div>`,
    )
    .join('');

  $<HTMLElement>('#prg-lista-periodos').innerHTML = programasOrdenados()
    .map((codigo) => {
      const lista = periodos.filter((p) => p.programa_codigo === codigo);
      const items = lista.length
        ? lista
            .map((p) => {
              const estado = estadoPeriodo(p, hoy);
              return `
            <li class="prg-periodo">
              <div class="prg-periodo__cabecera">
                <p class="prg-periodo__nombre">${esc(p.nombre)}</p>
                <span class="admin-badge ${CLASE_BADGE[estado]}">${ESTADO_PERIODO_LABEL[estado]}</span>
              </div>
              <dl class="prg-periodo__fechas">
                <div><dt>Abre</dt><dd>${fechaLarga(p.abre)}</dd></div>
                <div><dt>Cierra</dt><dd>${p.cierra ? fechaLarga(p.cierra) : 'Sin fecha de cierre'}</dd></div>
                <div><dt>Inicio de clases</dt><dd>${p.clases_inician ? fechaLarga(p.clases_inician) : 'Por definir'}</dd></div>
              </dl>
              <div class="prg-periodo__acciones">
                <button type="button" class="admin-btn admin-btn--secundario" data-accion="editar" data-id="${p.id}">Editar</button>
                <button type="button" class="admin-btn admin-btn--secundario" data-accion="activo" data-id="${p.id}">${
                  p.activo ? 'Desactivar' : 'Activar'
                }</button>
                <button type="button" class="admin-btn admin-btn--peligro" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
              </div>
            </li>`;
            })
            .join('')
        : '<li class="admin-vacio">Sin periodos. Mientras no exista uno, las inscripciones de este programa se consideran cerradas.</li>';
      return `<h3 class="ficha-bloque__subtitulo">${esc(nombrePrograma(codigo))}</h3><ul class="prg-periodos">${items}</ul>`;
    })
    .join('');
}

function limpiarFormularioPeriodo(): void {
  editandoId = null;
  $<HTMLInputElement>('#prg-p-nombre').value = '';
  $<HTMLInputElement>('#prg-p-abre').value = '';
  $<HTMLInputElement>('#prg-p-cierra').value = '';
  $<HTMLInputElement>('#prg-p-clases').value = '';
  $<HTMLElement>('#prg-form-titulo').textContent = 'Agregar periodo';
  $<HTMLButtonElement>('#prg-p-guardar').textContent = 'Agregar periodo';
  $<HTMLButtonElement>('#prg-p-cancelar').hidden = true;
  $<HTMLElement>('#prg-periodo-error').hidden = true;
}

function cargarEnFormulario(p: PeriodoConId): void {
  editandoId = p.id;
  $<HTMLSelectElement>('#prg-p-programa').value = p.programa_codigo;
  $<HTMLInputElement>('#prg-p-nombre').value = p.nombre;
  $<HTMLInputElement>('#prg-p-abre').value = p.abre;
  $<HTMLInputElement>('#prg-p-cierra').value = p.cierra ?? '';
  $<HTMLInputElement>('#prg-p-clases').value = p.clases_inician ?? '';
  $<HTMLElement>('#prg-form-titulo').textContent = `Editar "${p.nombre}"`;
  $<HTMLButtonElement>('#prg-p-guardar').textContent = 'Guardar cambios';
  $<HTMLButtonElement>('#prg-p-cancelar').hidden = false;
  $<HTMLFormElement>('#prg-form-periodo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function recargarPeriodos(): Promise<void> {
  config = await obtenerConfigProgramas(supabase);
  renderEstado();
  renderPeriodos();
}

async function onGuardarPeriodo(evt: Event): Promise<void> {
  evt.preventDefault();
  const error = $<HTMLElement>('#prg-periodo-error');
  error.hidden = true;

  const actual = editandoId ? (config.periodos as PeriodoConId[]).find((p) => p.id === editandoId) : null;
  const v = validarPeriodo({
    programa_codigo: $<HTMLSelectElement>('#prg-p-programa').value,
    nombre: $<HTMLInputElement>('#prg-p-nombre').value,
    abre: $<HTMLInputElement>('#prg-p-abre').value,
    cierra: $<HTMLInputElement>('#prg-p-cierra').value,
    clases_inician: $<HTMLInputElement>('#prg-p-clases').value,
    activo: actual ? actual.activo : true,
  });
  if (!v.ok) {
    error.textContent = v.error;
    error.hidden = false;
    return;
  }

  try {
    if (editandoId) await actualizarPeriodo(supabase, editandoId, v.valor);
    else await crearPeriodo(supabase, v.valor);
    limpiarFormularioPeriodo();
    await recargarPeriodos();
  } catch {
    error.textContent = 'No se pudo guardar el periodo. Revisa tu conexión e inténtalo nuevamente.';
    error.hidden = false;
  }
}

async function onAccionPeriodo(evt: Event): Promise<void> {
  const boton = (evt.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
  if (!boton) return;
  const periodo = (config.periodos as PeriodoConId[]).find((p) => p.id === boton.dataset.id);
  if (!periodo) return;

  const error = $<HTMLElement>('#prg-periodo-error');
  error.hidden = true;
  try {
    if (boton.dataset.accion === 'editar') {
      cargarEnFormulario(periodo);
      return;
    }
    boton.disabled = true;
    if (boton.dataset.accion === 'activo') {
      await actualizarPeriodo(supabase, periodo.id, { activo: !periodo.activo });
    } else if (boton.dataset.accion === 'eliminar') {
      if (!confirm(`¿Eliminar el periodo "${periodo.nombre}"? Si solo quieres dejar de usarlo, es mejor desactivarlo.`)) {
        boton.disabled = false;
        return;
      }
      await eliminarPeriodo(supabase, periodo.id);
      if (editandoId === periodo.id) limpiarFormularioPeriodo();
    }
    await recargarPeriodos();
  } catch {
    boton.disabled = false;
    error.textContent = 'No se pudo completar la acción. Revisa tu conexión e inténtalo nuevamente.';
    error.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

export async function iniciarConfiguracionProgramas(cliente: SupabaseClient): Promise<void> {
  supabase = cliente;
  const aviso = $<HTMLElement>('#prg-aviso');

  try {
    config = await obtenerConfigProgramas(supabase);
  } catch (e) {
    aviso.textContent =
      e instanceof MigracionPendienteError
        ? 'Precios y periodos de inscripción estarán disponibles después de ejecutar la migración 0007 en Supabase.'
        : 'No se pudo cargar la configuración de programas. Recarga la página o inténtalo más tarde.';
    aviso.hidden = false;
    return;
  }

  const anioActual = Number(hoyChile().slice(0, 4));
  const temporadas = temporadasDisponibles();
  temporada = temporadas.includes(anioActual) ? anioActual : temporadas[temporadas.length - 1] ?? anioActual;

  $<HTMLSelectElement>('#prg-p-programa').innerHTML = programasOrdenados()
    .map((c) => `<option value="${c}">${esc(nombrePrograma(c))}</option>`)
    .join('');

  renderEstado();
  renderPrecios();
  renderPeriodos();

  $<HTMLSelectElement>('#prg-temporada').addEventListener('change', (e) => {
    temporada = Number((e.target as HTMLSelectElement).value);
    renderPrecios();
  });
  $<HTMLFormElement>('#prg-form-precios').addEventListener('submit', onGuardarPrecios);
  $<HTMLButtonElement>('#prg-nueva-temporada').addEventListener('click', onNuevaTemporada);
  $<HTMLFormElement>('#prg-form-periodo').addEventListener('submit', onGuardarPeriodo);
  $<HTMLButtonElement>('#prg-p-cancelar').addEventListener('click', limpiarFormularioPeriodo);
  $<HTMLElement>('#prg-lista-periodos').addEventListener('click', (e) => void onAccionPeriodo(e));

  for (const id of ['#prg-estado', '#prg-precios', '#prg-periodos']) $<HTMLElement>(id).hidden = false;
}
