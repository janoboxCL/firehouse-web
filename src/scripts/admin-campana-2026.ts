import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerResumenCampana,
  obtenerOrdenesCampana,
  obtenerParticipacionesGratisCampana,
  obtenerParticipantesCampana,
  reenviarCorreoCampana,
  type ParticipanteCampana,
} from '../lib/crm/admin-campana-api.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

/** Escapa texto ingresado por el público antes de insertarlo en el panel. */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const ETIQUETA_CORREO: Record<string, string> = {
  PENDING: 'Pendiente',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Fallido',
};

function renderParticipantes(participantes: ParticipanteCampana[]): string {
  if (participantes.length === 0) return '<tr><td colspan="8" class="cc-vacio">Sin participantes.</td></tr>';
  return participantes
    .map((p) => {
      const correos = p.correos.length
        ? p.correos
            .map(
              (c) => `<div class="cc-correo">
                <span>${c.tipo === 'CONFIRMACION_COMPRA' ? 'Compra' : 'Sin compra'}: ${ETIQUETA_CORREO[c.status] ?? esc(c.status)}${
                  c.attempts > 1 ? ` (${c.attempts} intentos)` : ''
                }</span>
                ${c.lastError && c.status === 'FAILED' ? `<br><span class="cc-sub">${esc(c.lastError)}</span>` : ''}
                ${c.status === 'SENDING' ? '' : `<br><button type="button" class="cc-btn-link" data-reenviar="${esc(c.id)}">Reenviar correo</button>`}
              </div>`,
            )
            .join('')
        : '—';
      return `<tr>
        <td><strong>${esc(p.nombre)}</strong><br><span class="cc-sub">${esc(p.email)}</span></td>
        <td class="cc-mono">${esc(p.rutMasked)}</td>
        <td>${p.compra}</td>
        <td>${p.gratis}</td>
        <td><strong>${p.total} / 3</strong>${p.invalidadas ? `<br><span class="cc-sub">${p.invalidadas} invalidada${p.invalidadas === 1 ? '' : 's'}</span>` : ''}</td>
        <td class="cc-mono">${p.codigos.map(esc).join(', ') || '—'}</td>
        <td class="cc-sub">${p.ordenes.map(esc).join('<br>') || '—'}</td>
        <td>${correos}</td>
      </tr>`;
    })
    .join('');
}

function formatearMonto(n: number): string {
  return `$${n.toLocaleString('es-CL')}`;
}

function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PAGADA: 'Pagada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
  EXPIRADA: 'Expirada',
  REEMBOLSADA: 'Reembolsada',
};

const NOMBRE_PRODUCTO: Record<string, string> = {
  BLAZE: 'Sobre Blaze',
  NOVA: 'Sobre Nova',
  BLAZE_NOVA: 'Pack Blaze + Nova',
};

function badgeEstado(estado: string): string {
  const clase = estado.toLowerCase();
  return `<span class="cc-badge cc-badge--${clase}">${ETIQUETA_ESTADO[estado] ?? estado}</span>`;
}

function mostrarError(mensaje: string): void {
  $('#ca-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#ca-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

export async function iniciarAdminCampana2026(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  try {
    const [resumen, ordenes, gratis, participantes] = await Promise.all([
      obtenerResumenCampana(supabase),
      obtenerOrdenesCampana(supabase),
      obtenerParticipacionesGratisCampana(supabase),
      obtenerParticipantesCampana(supabase),
    ]);

    // ---- resumen ----
    $('#ca-ordenes-pagadas')!.textContent = String(resumen.ordenesPagadas);
    $('#ca-ordenes-pendientes')!.textContent = String(resumen.ordenesPendientes);
    $('#ca-entradas-compra')!.textContent = String(resumen.entradasCompra);
    $('#ca-entradas-gratis')!.textContent = String(resumen.entradasGratis);
    $('#ca-personas')!.textContent = String(resumen.personasUnicas);
    $('#ca-distribucion')!.textContent = `1: ${resumen.personasPorTotal[1]} · 2: ${resumen.personasPorTotal[2]} · 3: ${resumen.personasPorTotal[3]} · emails fallidos: ${resumen.emailsFallidos}`;
    if (resumen.entradasInvalidadas > 0) {
      $('#ca-invalidadas')!.textContent = `${resumen.entradasInvalidadas} entrada(s) invalidada(s) por reembolso`;
      $('#ca-invalidadas')?.removeAttribute('hidden');
    }

    const recaudadoTotal = Object.values(resumen.recaudadoPorPasarela).reduce((a, b) => a + b, 0);
    $('#ca-recaudado')!.textContent = formatearMonto(recaudadoTotal);
    const desglose = $('#ca-recaudado-desglose')!;
    desglose.innerHTML =
      Object.entries(resumen.recaudadoPorPasarela)
        .map(([pasarela, monto]) => `<span><strong>${pasarela}:</strong> ${formatearMonto(monto)}</span>`)
        .join('') || '<span>Sin pagos aprobados todavía</span>';

    // ---- pasarelas ----
    const pasarelasEl = $('#ca-pasarelas')!;
    pasarelasEl.innerHTML = resumen.pasarelas
      .map((p) => {
        const estado = p.habilitada ? (p.preferida ? 'Habilitada · preferida' : 'Habilitada') : 'Deshabilitada';
        const clase = p.habilitada ? 'cc-badge--pagada' : 'cc-badge--anulada';
        return `<span class="cc-badge ${clase}">${p.id}: ${estado}</span>`;
      })
      .join(' ');

    // ---- órdenes ----
    const tbodyOrdenes = $('#ca-tabla-ordenes tbody')!;
    if (ordenes.length === 0) {
      tbodyOrdenes.innerHTML = '<tr><td colspan="7" class="cc-vacio">Todavía no hay órdenes.</td></tr>';
    } else {
      tbodyOrdenes.innerHTML = ordenes
        .map((o) => {
          const productos = o.items.map((i) => NOMBRE_PRODUCTO[i.producto] ?? i.producto).join(', ');
          const codigos = o.items.map((i) => i.codigo).filter(Boolean).join(', ') || '—';
          return `
            <tr>
              <td>
                <strong>${esc(o.compradorNombre)}</strong><br/>
                <span class="cc-sub">${esc(o.compradorEmail)} · ${esc(o.compradorTelefono)}</span>
                ${o.atletaReferido ? `<br/><span class="cc-sub">Referido: ${esc(o.atletaReferido)}</span>` : ''}
              </td>
              <td>${productos}</td>
              <td class="cc-num">${formatearMonto(o.monto)}</td>
              <td>${o.pago ? `${o.pago.pasarela}<br/><span class="cc-sub">${esc(o.pago.metodoPago ?? '')}</span>` : '—'}</td>
              <td>${badgeEstado(o.estado)}</td>
              <td class="cc-mono">${codigos}</td>
              <td class="cc-sub">${formatearFecha(o.paidAt ?? o.createdAt)}</td>
            </tr>`;
        })
        .join('');
    }

    // ---- participación gratuita ----
    const tbodyParticipantes = $('#ca-tabla-participantes tbody')!;
    tbodyParticipantes.innerHTML = renderParticipantes(participantes);
    tbodyParticipantes.onclick = async (evt) => {
      const boton = (evt.target as HTMLElement).closest<HTMLButtonElement>('button[data-reenviar]');
      if (!boton) return;
      if (!confirm('¿Reenviar este correo? No se generan participaciones nuevas.')) return;
      boton.disabled = true;
      boton.textContent = 'Enviando…';
      try {
        await reenviarCorreoCampana(supabase, boton.dataset.reenviar!);
        boton.textContent = 'Correo reenviado';
      } catch (e) {
        boton.disabled = false;
        boton.textContent = 'Reintentar';
        alert(`No se pudo reenviar: ${e instanceof Error ? e.message : 'error desconocido'}`);
      }
    };

    const tbodyGratis = $('#ca-tabla-gratis tbody')!;
    if (gratis.length === 0) {
      tbodyGratis.innerHTML = '<tr><td colspan="5" class="cc-vacio">Todavía no hay participaciones sin compra.</td></tr>';
    } else {
      tbodyGratis.innerHTML = gratis
        .map(
          (g) => `
            <tr>
              <td>${esc(g.nombreCompleto)}</td>
              <td class="cc-mono">${esc(g.rut)}</td>
              <td><span class="cc-sub">${esc(g.email)} · ${esc(g.telefono)}</span></td>
              <td class="cc-mono">${esc(g.codigo ?? '—')}</td>
              <td class="cc-sub">${formatearFecha(g.createdAt)}</td>
            </tr>`,
        )
        .join('');
    }

    $('#ca-cargando')?.setAttribute('hidden', '');
    $('#ca-contenido')?.removeAttribute('hidden');
  } catch (e) {
    mostrarError(e instanceof Error ? e.message : 'No pudimos cargar los datos de la campaña.');
  }
}
