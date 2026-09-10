import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerResumenCampana,
  obtenerOrdenesCampana,
  obtenerParticipacionesGratisCampana,
} from '../lib/crm/admin-campana-api.ts';

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
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
    const [resumen, ordenes, gratis] = await Promise.all([
      obtenerResumenCampana(supabase),
      obtenerOrdenesCampana(supabase),
      obtenerParticipacionesGratisCampana(supabase),
    ]);

    // ---- resumen ----
    $('#ca-ordenes-pagadas')!.textContent = String(resumen.ordenesPagadas);
    $('#ca-ordenes-pendientes')!.textContent = String(resumen.ordenesPendientes);
    $('#ca-entradas-compra')!.textContent = String(resumen.entradasCompra);
    $('#ca-entradas-gratis')!.textContent = String(resumen.entradasGratis);
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
                <strong>${o.compradorNombre}</strong><br/>
                <span class="cc-sub">${o.compradorEmail} · ${o.compradorTelefono}</span>
                ${o.atletaReferido ? `<br/><span class="cc-sub">Referido: ${o.atletaReferido}</span>` : ''}
              </td>
              <td>${productos}</td>
              <td class="cc-num">${formatearMonto(o.monto)}</td>
              <td>${o.pago ? `${o.pago.pasarela}<br/><span class="cc-sub">${o.pago.metodoPago ?? ''}</span>` : '—'}</td>
              <td>${badgeEstado(o.estado)}</td>
              <td class="cc-mono">${codigos}</td>
              <td class="cc-sub">${formatearFecha(o.paidAt ?? o.createdAt)}</td>
            </tr>`;
        })
        .join('');
    }

    // ---- participación gratuita ----
    const tbodyGratis = $('#ca-tabla-gratis tbody')!;
    if (gratis.length === 0) {
      tbodyGratis.innerHTML = '<tr><td colspan="5" class="cc-vacio">Todavía no hay participaciones sin compra.</td></tr>';
    } else {
      tbodyGratis.innerHTML = gratis
        .map(
          (g) => `
            <tr>
              <td>${g.nombreCompleto}</td>
              <td class="cc-mono">${g.rut}</td>
              <td><span class="cc-sub">${g.email} · ${g.telefono}</span></td>
              <td class="cc-mono">${g.codigo ?? '—'}</td>
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
