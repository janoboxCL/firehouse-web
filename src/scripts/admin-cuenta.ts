// Sección "Cuenta y pagos" de la ficha del apoderado.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anularCargo,
  generarLinkPago,
  obtenerCuenta,
  registrarPagoManual,
  revocarLink,
  type CuentaPanel,
} from '../lib/crm/admin-cuenta-api.ts';
import { enlaceWhatsApp, primerNombre } from '../lib/crm/plantillas.ts';
import { hoyChile } from '../lib/crm/programas.ts';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const fecha = (iso: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const ESTADO: Record<string, string> = { PAGADO: 'Pagado', PENDIENTE: 'Pendiente', PARCIAL: 'Parcial', ANULADO: 'Anulado' };
const MEDIO: Record<string, string> = { MERCADOPAGO: 'Mercado Pago', FLOW: 'Flow', EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia' };
const ESTADO_PAGO: Record<string, string> = { APROBADO: 'Aprobado', PENDIENTE: 'Pendiente', RECHAZADO: 'Rechazado', ANULADO: 'Anulado', REEMBOLSADO: 'Reembolsado' };

let supabase: SupabaseClient;
let apoderadoId: string;
let telefono: string;
let nombre: string;
let cuenta: CuentaPanel;

function mostrarError(m: string): void {
  const e = $<HTMLElement>('#cu-error');
  e.textContent = m;
  e.hidden = false;
  $<HTMLElement>('#cu-ok').hidden = true;
}

function mostrarOk(m: string): void {
  const e = $<HTMLElement>('#cu-ok');
  e.textContent = m;
  e.hidden = false;
  $<HTMLElement>('#cu-error').hidden = true;
}

function textoWhatsApp(url: string): string {
  return `¡Hola, ${primerNombre(nombre)}! Este es el link de tu página de pagos Firehouse: ${url}\nAhí puedes ver y pagar lo pendiente. Guárdalo: es el mismo cada mes.`;
}

function render(): void {
  const hoy = hoyChile();
  $<HTMLElement>('#cu-link').innerHTML = cuenta.link
    ? `<button type="button" class="admin-btn admin-btn--whatsapp" data-cu="enviar">Enviar link por WhatsApp</button>
       <button type="button" class="admin-btn admin-btn--secundario" data-cu="copiar">Copiar link</button>
       <button type="button" class="admin-btn admin-btn--secundario" data-cu="revocar">Revocar link</button>`
    : '<button type="button" class="admin-btn" data-cu="link">Generar link de pago</button>';

  $<HTMLElement>('#cu-preparar').innerHTML = cuenta.atletas
    .map((a) => `<button type="button" class="admin-btn admin-btn--secundario" data-cu="star" data-atleta="${esc(a.id)}">Preparar cobro Star de ${esc(a.nombre)}</button>`)
    .join('');

  const cargos = cuenta.cargos;
  $<HTMLElement>('#cu-sin-cargos').hidden = cargos.length > 0;
  $<HTMLElement>('#cu-cargos').innerHTML = cargos
    .map((c) => {
      const abierto = c.estado === 'PENDIENTE' || c.estado === 'PARCIAL';
      const vencido = abierto && !!c.vencimiento && c.vencimiento < hoy;
      return `<tr>
        <td>${abierto ? `<input type="checkbox" value="${esc(c.id)}" data-saldo="${c.saldo}" aria-label="Seleccionar ${esc(c.descripcion)}" />` : ''}</td>
        <td>${esc(c.atleta_nombre ?? '—')}</td>
        <td>${esc(c.descripcion)}</td>
        <td class="cu-num">${pesos(c.monto)}</td>
        <td class="cu-num">${abierto ? pesos(c.saldo) : '—'}</td>
        <td class="${vencido ? 'cu-vencido' : ''}">${c.vencimiento ? fecha(c.vencimiento) : '—'}</td>
        <td><span class="cu-estado cu-estado--${c.estado.toLowerCase()}">${ESTADO[c.estado] ?? c.estado}</span></td>
        <td>${c.estado === 'PENDIENTE' && c.saldo === c.monto ? `<button type="button" class="cu-anular" data-cu="anular" data-cargo="${esc(c.id)}">Anular</button>` : ''}</td>
      </tr>`;
    })
    .join('');

  $<HTMLElement>('#cu-pagos').innerHTML = cuenta.pagos.length
    ? cuenta.pagos
        .map((p) => {
          const lineas = p.detalle
            .map((d) => {
              const c = cargos.find((x) => x.id === d.cargo_id);
              return `${c?.atleta_nombre ? `${esc(c.atleta_nombre)}: ` : ''}${esc(c?.descripcion ?? 'Cargo')} (${pesos(d.monto)})`;
            })
            .join('<br/>');
          return `<li><strong>${fechaHora(p.aprobado_at ?? p.created_at)} · ${pesos(p.monto_total)}</strong> · ${esc(MEDIO[p.medio] ?? p.medio)} · ${
            ESTADO_PAGO[p.estado] ?? esc(p.estado)
          }<br/><span class="cc-sub">N° ${esc(p.commerce_order)}${p.referencia ? ` · ${esc(p.referencia)}` : ''}</span><br/>${lineas}</li>`;
        })
        .join('')
    : '<li class="admin-vacio">Sin pagos registrados.</li>';

  actualizarBotonManual();
}

function actualizarBotonManual(): void {
  const sel = [...document.querySelectorAll<HTMLInputElement>('#cu-cargos input[type=checkbox]:checked')];
  const total = sel.reduce((s, i) => s + Number(i.dataset.saldo), 0);
  const b = $<HTMLButtonElement>('#cu-registrar');
  b.disabled = sel.length === 0;
  b.textContent = sel.length ? `Registrar pago de ${pesos(total)}` : 'Selecciona cargos';
}

async function accion(boton: HTMLButtonElement): Promise<void> {
  const tipo = boton.dataset.cu;
  try {
    if (tipo === 'enviar' && cuenta.link) {
      window.open(enlaceWhatsApp(telefono, textoWhatsApp(cuenta.link)), '_blank', 'noopener');
      return;
    }
    if (tipo === 'copiar' && cuenta.link) {
      await navigator.clipboard.writeText(cuenta.link);
      mostrarOk('Link copiado.');
      return;
    }
    boton.disabled = true;
    if (tipo === 'link') {
      await generarLinkPago(supabase, { apoderadoId });
      mostrarOk('Link generado.');
    } else if (tipo === 'star') {
      const r = await generarLinkPago(supabase, { atletaId: boton.dataset.atleta });
      mostrarOk(r.aviso ?? (r.creados.length ? `Cargos creados: ${r.creados.map((c) => (c === 'INSCRIPCION' ? 'inscripción' : 'mensualidad')).join(' y ')}.` : 'Los cargos Star ya existían.'));
    } else if (tipo === 'revocar') {
      if (!confirm('¿Revocar el link? El link actual dejará de funcionar y habrá que enviar uno nuevo.')) return;
      cuenta = await revocarLink(supabase, apoderadoId);
      mostrarOk('Link revocado.');
      render();
      return;
    } else if (tipo === 'anular') {
      const motivo = prompt('Motivo de la anulación (queda registrado):')?.trim();
      if (!motivo) return;
      cuenta = await anularCargo(supabase, boton.dataset.cargo!, motivo);
      mostrarOk('Cargo anulado.');
      render();
      return;
    }
    cuenta = await obtenerCuenta(supabase, apoderadoId);
    render();
  } catch (e) {
    mostrarError(e instanceof Error ? e.message : 'No se pudo completar la acción.');
  } finally {
    boton.disabled = false;
  }
}

export async function iniciarCuentaFamilia(cliente: SupabaseClient, id: string, tel: string, nombreApoderado: string): Promise<void> {
  supabase = cliente;
  apoderadoId = id;
  telefono = tel;
  nombre = nombreApoderado;
  const seccion = $<HTMLElement>('#cu-seccion');
  try {
    cuenta = await obtenerCuenta(supabase, apoderadoId);
  } catch (e) {
    mostrarError(e instanceof Error ? e.message : 'No se pudo cargar la cuenta.');
    return;
  }
  render();

  seccion.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cu]');
    if (b) void accion(b);
  });
  $<HTMLElement>('#cu-cargos').addEventListener('change', actualizarBotonManual);
  $<HTMLFormElement>('#cu-form-manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = [...document.querySelectorAll<HTMLInputElement>('#cu-cargos input[type=checkbox]:checked')].map((i) => i.value);
    const medio = $<HTMLSelectElement>('#cu-medio').value;
    const total = [...document.querySelectorAll<HTMLInputElement>('#cu-cargos input[type=checkbox]:checked')].reduce((s, i) => s + Number(i.dataset.saldo), 0);
    if (!confirm(`¿Registrar un pago en ${medio === 'EFECTIVO' ? 'efectivo' : 'transferencia'} por ${pesos(total)}? Se enviará el comprobante a la familia.`)) return;
    const b = $<HTMLButtonElement>('#cu-registrar');
    b.disabled = true;
    try {
      cuenta = await registrarPagoManual(supabase, apoderadoId, ids, medio, $<HTMLInputElement>('#cu-referencia').value);
      $<HTMLInputElement>('#cu-referencia').value = '';
      mostrarOk(cuenta.comprobante ? 'Pago registrado. Comprobante enviado.' : 'Pago registrado. No se pudo enviar el comprobante por correo.');
      render();
    } catch (err) {
      mostrarError(err instanceof Error ? err.message : 'No se pudo registrar el pago.');
      actualizarBotonManual();
    }
  });
}
