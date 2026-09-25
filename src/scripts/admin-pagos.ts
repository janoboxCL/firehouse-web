// Menú de pagos (/admin/pagos): familias por programa, con acciones rápidas.

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import { escaparHtml } from '../lib/crm/format.ts';
import { generarLinkPago, registrarPagoManual } from '../lib/crm/admin-cuenta-api.ts';
import {
  buscarFamilias,
  crearCargoManual,
  marcarFamiliaPrueba,
  obtenerResumenPagos,
  registrarKitStar,
  type FamiliaBuscada,
  type ResumenPagos,
} from '../lib/crm/admin-pagos-api.ts';
import {
  ESTADO_FAMILIA_LABEL,
  mensajeLinkPago,
  type EstadoFamilia,
  type FamiliaPagos,
  type ProgramaPagos,
} from '../lib/crm/pagos-panel.ts';
import { CRM_ESTADOS_LABEL } from '../lib/crm/constants.ts';
import { enlaceWhatsApp } from '../lib/crm/plantillas.ts';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const fechaHoraCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const nombreMes = (hoy: string) =>
  new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' }).format(new Date(`${hoy.slice(0, 7)}-15T12:00:00Z`));

type Filtro = 'TODAS' | EstadoFamilia;
const FILTROS: Filtro[] = ['TODAS', 'VENCIDO', 'PENDIENTE', 'SIN_CARGOS', 'AL_DIA'];

let supabase: SupabaseClient;
let PROGRAMA: ProgramaPagos = 'STAR';
let RESUMEN: ResumenPagos | null = null;
let FILTRO: Filtro = 'TODAS';
let VER_PRUEBA = false;

function mostrarError(m: string): void {
  const e = $<HTMLElement>('#pg-error');
  e.textContent = m;
  e.hidden = false;
  $<HTMLElement>('#pg-ok').hidden = true;
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function mostrarOk(m: string): void {
  const e = $<HTMLElement>('#pg-ok');
  e.textContent = m;
  e.hidden = false;
  $<HTMLElement>('#pg-error').hidden = true;
}

function leerPreferencias(): void {
  try {
    const p = sessionStorage.getItem('pg-programa');
    if (p === 'STAR' || p === 'ALL_STAR') PROGRAMA = p;
  } catch {
    /* sin almacenamiento: se usa Star */
  }
}

function guardarPrograma(): void {
  try {
    sessionStorage.setItem('pg-programa', PROGRAMA);
  } catch {
    /* no es importante */
  }
}

// ---------------------------------------------------------------------------
// Carga y dibujo

async function cargar(): Promise<void> {
  $<HTMLElement>('#pg-cargando').hidden = false;
  try {
    RESUMEN = await obtenerResumenPagos(supabase, PROGRAMA);
    dibujar();
  } catch (err) {
    mostrarError((err as Error).message);
  } finally {
    $<HTMLElement>('#pg-cargando').hidden = true;
  }
}

function familiasVisibles(): FamiliaPagos[] {
  if (!RESUMEN) return [];
  const q = $<HTMLInputElement>('#pg-buscar').value.trim().toLowerCase();
  return RESUMEN.familias.filter((f) => {
    if (f.apoderado.es_prueba && !VER_PRUEBA) return false;
    if (FILTRO !== 'TODAS' && f.estado !== FILTRO) return false;
    if (!q) return true;
    const texto = [f.nombre, f.apoderado.telefono, f.apoderado.email, ...f.atletas.map((a) => a.nombre)].join(' ').toLowerCase();
    return texto.includes(q);
  });
}

function dibujar(): void {
  if (!RESUMEN) return;
  document.querySelectorAll<HTMLButtonElement>('#pg-programa [data-programa]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.programa === PROGRAMA));
  });

  const t = RESUMEN.totales;
  $<HTMLElement>('#pg-t-cobrar').textContent = pesos(t.porCobrar);
  $<HTMLElement>('#pg-t-vencido').textContent = pesos(t.vencido);
  $<HTMLElement>('#pg-t-mes-etiqueta').textContent = `Recaudado en ${nombreMes(RESUMEN.hoy)}`;
  $<HTMLElement>('#pg-t-mes').textContent = pesos(t.recaudadoMes);
  $<HTMLElement>('#pg-t-familias').textContent = `${t.conDeuda} de ${t.familias}`;

  const aviso = $<HTMLElement>('#pg-aviso-programa');
  aviso.hidden = PROGRAMA !== 'ALL_STAR';
  aviso.textContent =
    'All Star todavía no genera sus cargos solo (matrícula y mensualidades llegan con la cobranza mensual). Por ahora puedes agregar cargos a mano.';

  const base = RESUMEN.familias.filter((f) => VER_PRUEBA || !f.apoderado.es_prueba);
  $<HTMLElement>('#pg-filtro').innerHTML = FILTROS.map((f) => {
    const n = f === 'TODAS' ? base.length : base.filter((x) => x.estado === f).length;
    const etiqueta = f === 'TODAS' ? 'Todas' : ESTADO_FAMILIA_LABEL[f];
    return `<button type="button" class="pg-chip" data-filtro="${f}" aria-pressed="${f === FILTRO}">${etiqueta} (${n})</button>`;
  }).join('');

  const visibles = familiasVisibles();
  $<HTMLElement>('#pg-vacio').hidden = visibles.length > 0;
  $<HTMLElement>('#pg-familias').innerHTML = visibles.map(tarjeta).join('');
}

function tarjeta(f: FamiliaPagos): string {
  const id = escaparHtml(f.apoderado.id);
  const atletas = f.atletas
    .map((a) => {
      const estado = a.estadoCaso ? ` · ${escaparHtml(CRM_ESTADOS_LABEL[a.estadoCaso] ?? a.estadoCaso)}` : '';
      const kit = a.kit === 'REGISTRADO' ? ' · kit pagado' : a.kit === 'PENDIENTE' ? ' · kit pagado en el registro' : '';
      return `<span class="pg-atleta${a.kit ? ' pg-atleta--kit' : ''}">${escaparHtml(a.nombre)}${estado}${kit}</span>`;
    })
    .join('');

  const cargos = f.abiertos.length
    ? `<table class="pg-cargos"><tbody>${f.abiertos
        .map(
          (c) => `<tr class="${c.vencido ? 'pg-vencido' : ''}">
            <td>${escaparHtml(c.atleta_nombre ?? 'Familia')}</td>
            <td>${escaparHtml(c.descripcion)}</td>
            <td class="pg-vence">${c.vencimiento ? `${c.vencido ? 'Venció' : 'Vence'} ${fechaCorta(c.vencimiento)}` : ''}</td>
            <td class="pg-num">${pesos(c.saldo)}</td>
          </tr>`,
        )
        .join('')}</tbody></table>`
    : '';

  const kits = f.kitsSinRegistrar
    .map(
      (k) => `<div class="pg-alerta">
        <span>Kit pagado en el registro Star (${pesos(k.monto)}, ${fechaHoraCorta(k.fecha)}) que aún no está en su cuenta.</span>
        <button type="button" class="admin-btn admin-btn--secundario" data-accion="kit" data-orden="${escaparHtml(k.orden_id)}" data-apoderado="${id}">Registrar en la cuenta</button>
      </div>`,
    )
    .join('');

  const preparar =
    PROGRAMA === 'STAR' && f.estado === 'SIN_CARGOS'
      ? f.atletas
          .map(
            (a) =>
              `<button type="button" class="admin-btn admin-btn--secundario" data-accion="preparar" data-atleta="${escaparHtml(a.id)}" data-apoderado="${id}">Preparar cobro Star de ${escaparHtml(a.nombre)}</button>`,
          )
          .join('')
      : '';

  const saldo =
    f.saldo > 0
      ? `<p class="pg-familia__monto">${pesos(f.saldo)}</p>${f.vencido > 0 ? `<p class="pg-familia__vencido">${pesos(f.vencido)} vencido</p>` : ''}`
      : `<p class="pg-familia__monto">$0</p>`;
  const ultimo = f.ultimoPago ? ` · último pago ${fechaHoraCorta(f.ultimoPago)}` : '';

  return `<article class="pg-familia${f.apoderado.es_prueba ? ' pg-familia--prueba' : ''}" data-apoderado="${id}">
    <div class="pg-familia__top">
      <div>
        <p class="pg-familia__nombre"><a href="/admin/apoderado?id=${id}">${escaparHtml(f.nombre)}</a>
          <span class="pg-estado pg-estado--${f.estado}">${ESTADO_FAMILIA_LABEL[f.estado]}</span>${
            f.apoderado.es_prueba ? '<span class="pg-estado pg-estado--prueba">Prueba</span>' : ''
          }</p>
        <p class="pg-familia__detalle">${escaparHtml(f.apoderado.telefono)} · ${escaparHtml(f.apoderado.email)}${ultimo}</p>
      </div>
      <div class="pg-familia__saldo">${saldo}</div>
    </div>
    <div class="pg-atletas">${atletas}</div>
    ${cargos}
    ${kits}
    <div class="pg-acciones">
      <button type="button" class="admin-btn admin-btn--whatsapp" data-accion="link-wa" data-apoderado="${id}">Enviar link por WhatsApp</button>
      <button type="button" class="admin-btn admin-btn--secundario" data-accion="link-copiar" data-apoderado="${id}">Copiar link</button>
      ${f.abiertos.length ? `<button type="button" class="admin-btn admin-btn--secundario" data-accion="pago" data-apoderado="${id}">Registrar pago</button>` : ''}
      <button type="button" class="admin-btn admin-btn--secundario" data-accion="cargo" data-apoderado="${id}">Agregar cargo</button>
      ${preparar}
      <button type="button" class="pg-link-suave" data-accion="prueba" data-apoderado="${id}">${
        f.apoderado.es_prueba ? 'Quitar marca de prueba' : 'Marcar como familia de prueba'
      }</button>
    </div>
  </article>`;
}

function familia(apoderadoId: string): FamiliaPagos | undefined {
  return RESUMEN?.familias.find((f) => f.apoderado.id === apoderadoId);
}

// ---------------------------------------------------------------------------
// Acciones de cada familia

async function asegurarLink(f: FamiliaPagos): Promise<string> {
  if (f.link) return f.link;
  const { url } = await generarLinkPago(supabase, { apoderadoId: f.apoderado.id });
  f.link = url;
  return url;
}

async function accion(boton: HTMLButtonElement): Promise<void> {
  const tipo = boton.dataset.accion;
  const f = familia(boton.dataset.apoderado ?? '');
  if (!f) return;

  if (tipo === 'link-wa') {
    // La ventana se abre en el mismo clic (evita el bloqueo) y se completa después.
    const ventana = f.link ? null : window.open('', '_blank');
    try {
      const destino = enlaceWhatsApp(f.apoderado.telefono, mensajeLinkPago(f.apoderado.nombre, await asegurarLink(f)));
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = destino;
      } else window.open(destino, '_blank', 'noopener');
    } catch (err) {
      ventana?.close();
      mostrarError((err as Error).message);
    }
    return;
  }

  if (tipo === 'link-copiar') {
    try {
      await navigator.clipboard.writeText(await asegurarLink(f));
      mostrarOk(`Link de ${f.nombre} copiado.`);
    } catch (err) {
      mostrarError((err as Error).message || 'No pudimos copiar el link.');
    }
    return;
  }

  if (tipo === 'pago') return abrirPago(f);
  if (tipo === 'cargo') return abrirCargo({ id: f.apoderado.id, nombre: f.nombre, atletas: f.atletas.map((a) => ({ id: a.id, nombre: a.nombre })) });

  boton.disabled = true;
  try {
    if (tipo === 'kit') {
      const r = await registrarKitStar(supabase, boton.dataset.orden ?? '');
      mostrarOk(r.repetido ? 'Ese kit ya estaba registrado.' : `Kit registrado en la cuenta de ${f.nombre}${r.monto ? ` (${pesos(r.monto)})` : ''}.`);
    } else if (tipo === 'preparar') {
      const r = await generarLinkPago(supabase, { atletaId: boton.dataset.atleta ?? '' });
      mostrarOk(r.creados.length ? `Cobro Star preparado para ${f.nombre}.` : r.aviso ?? 'No había cargos nuevos que crear.');
    } else if (tipo === 'prueba') {
      await marcarFamiliaPrueba(supabase, f.apoderado.id, !f.apoderado.es_prueba);
      mostrarOk(f.apoderado.es_prueba ? `${f.nombre} ya no es familia de prueba.` : `${f.nombre} quedó como familia de prueba (no cuenta en los totales).`);
    }
    await cargar();
  } catch (err) {
    mostrarError((err as Error).message);
  } finally {
    boton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Diálogo: registrar pago

let PAGO_FAMILIA: FamiliaPagos | null = null;

function abrirPago(f: FamiliaPagos): void {
  PAGO_FAMILIA = f;
  $<HTMLElement>('#pg-pago-familia').textContent = f.nombre;
  $<HTMLElement>('#pg-pago-error').hidden = true;
  $<HTMLInputElement>('#pg-pago-referencia').value = '';
  $<HTMLElement>('#pg-pago-cargos').innerHTML = f.abiertos
    .map(
      (c) => `<label><input type="checkbox" value="${escaparHtml(c.id)}" data-saldo="${c.saldo}" ${c.vencido ? 'checked' : ''} />
        <span>${escaparHtml(c.atleta_nombre ?? 'Familia')} · ${escaparHtml(c.descripcion)}${c.vencido ? ' (vencido)' : ''}</span>
        <span>${pesos(c.saldo)}</span></label>`,
    )
    .join('');
  actualizarTotalPago();
  $<HTMLDialogElement>('#pg-dialogo-pago').showModal();
}

function seleccionPago(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('#pg-pago-cargos input:checked')];
}

function actualizarTotalPago(): void {
  const sel = seleccionPago();
  const total = sel.reduce((s, i) => s + Number(i.dataset.saldo), 0);
  const boton = $<HTMLButtonElement>('#pg-pago-registrar');
  boton.disabled = sel.length === 0;
  boton.textContent = sel.length ? `Registrar ${pesos(total)}` : 'Selecciona cargos';
}

async function enviarPago(evt: Event): Promise<void> {
  evt.preventDefault();
  if (!PAGO_FAMILIA) return;
  const ids = seleccionPago().map((i) => i.value);
  const boton = $<HTMLButtonElement>('#pg-pago-registrar');
  const error = $<HTMLElement>('#pg-pago-error');
  error.hidden = true;
  boton.disabled = true;
  try {
    const r = await registrarPagoManual(
      supabase,
      PAGO_FAMILIA.apoderado.id,
      ids,
      $<HTMLSelectElement>('#pg-pago-medio').value,
      $<HTMLInputElement>('#pg-pago-referencia').value,
    );
    $<HTMLDialogElement>('#pg-dialogo-pago').close();
    mostrarOk(`Pago de ${PAGO_FAMILIA.nombre} registrado.${r.comprobante ? ' Comprobante enviado por correo.' : ''}`);
    await cargar();
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    actualizarTotalPago();
  }
}

// ---------------------------------------------------------------------------
// Diálogo: agregar cargo

interface FamiliaCargo {
  id: string;
  nombre: string;
  atletas: Array<{ id: string; nombre: string }>;
}
let CARGO_FAMILIA: FamiliaCargo | null = null;

function elegirFamiliaCargo(f: FamiliaCargo | null): void {
  CARGO_FAMILIA = f;
  $<HTMLElement>('#pg-cargo-busqueda').hidden = !!f;
  const etiqueta = $<HTMLElement>('#pg-cargo-familia');
  etiqueta.hidden = !f;
  etiqueta.textContent = f ? f.nombre : '';
  $<HTMLSelectElement>('#pg-cargo-atleta').innerHTML =
    '<option value="">Toda la familia</option>' +
    (f?.atletas ?? []).map((a) => `<option value="${escaparHtml(a.id)}">${escaparHtml(a.nombre)}</option>`).join('');
}

function abrirCargo(f: FamiliaCargo | null): void {
  $<HTMLFormElement>('#pg-form-cargo').reset();
  $<HTMLSelectElement>('#pg-cargo-programa').value = PROGRAMA;
  $<HTMLElement>('#pg-cargo-resultados').innerHTML = '';
  $<HTMLElement>('#pg-cargo-error').hidden = true;
  elegirFamiliaCargo(f);
  $<HTMLDialogElement>('#pg-dialogo-cargo').showModal();
  if (!f) $<HTMLInputElement>('#pg-cargo-buscar').focus();
}

let RESULTADOS: FamiliaBuscada[] = [];
let temporizador: ReturnType<typeof setTimeout> | undefined;

function buscarParaCargo(): void {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    const texto = $<HTMLInputElement>('#pg-cargo-buscar').value.trim();
    const cont = $<HTMLElement>('#pg-cargo-resultados');
    if (texto.length < 2) {
      cont.innerHTML = '';
      return;
    }
    try {
      RESULTADOS = (await buscarFamilias(supabase, texto)).resultados;
      cont.innerHTML = RESULTADOS.length
        ? RESULTADOS.map(
            (r) => `<button type="button" class="pg-resultado" data-id="${escaparHtml(r.id)}">${escaparHtml(`${r.nombre} ${r.apellidos}`)}${
              r.es_prueba ? ' (prueba)' : ''
            }<small>${escaparHtml(r.email)} · ${escaparHtml(r.atletas.map((a) => a.nombre.split(' ')[0]).join(', ') || 'sin deportistas')}</small></button>`,
          ).join('')
        : '<p class="pg-dialogo__nota">No encontramos familias con ese texto.</p>';
    } catch (err) {
      cont.innerHTML = `<p class="pg-dialogo__error">${escaparHtml((err as Error).message)}</p>`;
    }
  }, 300);
}

async function enviarCargo(evt: Event): Promise<void> {
  evt.preventDefault();
  const error = $<HTMLElement>('#pg-cargo-error');
  error.hidden = true;
  if (!CARGO_FAMILIA) {
    error.textContent = 'Busca y elige la familia.';
    error.hidden = false;
    return;
  }
  const programa = $<HTMLSelectElement>('#pg-cargo-programa').value as ProgramaPagos;
  const boton = $<HTMLButtonElement>('#pg-cargo-crear');
  boton.disabled = true;
  try {
    await crearCargoManual(supabase, {
      apoderadoId: CARGO_FAMILIA.id,
      atletaId: $<HTMLSelectElement>('#pg-cargo-atleta').value || null,
      programa,
      concepto: $<HTMLSelectElement>('#pg-cargo-concepto').value,
      descripcion: $<HTMLInputElement>('#pg-cargo-descripcion').value,
      monto: Number($<HTMLInputElement>('#pg-cargo-monto').value),
      vencimiento: $<HTMLInputElement>('#pg-cargo-vencimiento').value || null,
    });
    $<HTMLDialogElement>('#pg-dialogo-cargo').close();
    mostrarOk(`Cargo agregado a ${CARGO_FAMILIA.nombre}.`);
    if (programa !== PROGRAMA) {
      PROGRAMA = programa;
      guardarPrograma();
    }
    await cargar();
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

// ---------------------------------------------------------------------------

export async function iniciarPagos(): Promise<void> {
  const sesion = await requireAdminSession();
  supabase = sesion.supabase;
  montarCabeceraAdmin(sesion.perfil);
  leerPreferencias();

  document.querySelectorAll<HTMLButtonElement>('#pg-programa [data-programa]').forEach((b) =>
    b.addEventListener('click', () => {
      PROGRAMA = b.dataset.programa as ProgramaPagos;
      FILTRO = 'TODAS';
      guardarPrograma();
      void cargar();
    }),
  );
  $('#pg-filtro').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filtro]');
    if (!b) return;
    FILTRO = b.dataset.filtro as Filtro;
    dibujar();
  });
  $('#pg-buscar').addEventListener('input', dibujar);
  $<HTMLInputElement>('#pg-ver-prueba').addEventListener('change', (e) => {
    VER_PRUEBA = (e.target as HTMLInputElement).checked;
    dibujar();
  });
  $('#pg-familias').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-accion]');
    if (b) void accion(b);
  });

  document.querySelectorAll<HTMLButtonElement>('dialog [data-cerrar]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog')?.close()),
  );
  $('#pg-pago-cargos').addEventListener('change', actualizarTotalPago);
  $('#pg-form-pago').addEventListener('submit', (e) => void enviarPago(e));

  $('#pg-btn-cargo').addEventListener('click', () => abrirCargo(null));
  $('#pg-cargo-buscar').addEventListener('input', buscarParaCargo);
  $('#pg-cargo-resultados').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.pg-resultado');
    const r = RESULTADOS.find((x) => x.id === b?.dataset.id);
    if (r) elegirFamiliaCargo({ id: r.id, nombre: `${r.nombre} ${r.apellidos}`, atletas: r.atletas.map((a) => ({ id: a.id, nombre: a.nombre.split(' ')[0] })) });
  });
  $('#pg-form-cargo').addEventListener('submit', (e) => void enviarCargo(e));

  await cargar();
}
