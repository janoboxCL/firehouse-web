import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerResumenConcurso,
  obtenerVentasConcurso,
  obtenerRankingConcurso,
} from '../lib/crm/admin-concurso-api.ts';

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

function mostrarError(mensaje: string): void {
  $('#cc-cargando')?.setAttribute('hidden', '');
  const el = $<HTMLElement>('#cc-error')!;
  el.textContent = mensaje;
  el.hidden = false;
}

export async function iniciarAdminConcurso(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  try {
    const [resumen, ventas, { ranking, ventaGenerica }] = await Promise.all([
      obtenerResumenConcurso(supabase),
      obtenerVentasConcurso(supabase),
      obtenerRankingConcurso(supabase),
    ]);

    // ---- tarjetas de resumen ----
    $('#cc-vendidos')!.textContent = `${resumen.vendidos} / ${resumen.totalNumeros}`;
    $('#cc-recaudado')!.textContent = formatearMonto(resumen.recaudado);
    $('#cc-reservados')!.textContent = String(resumen.reservados);
    $('#cc-pendientes')!.textContent = String(resumen.ventasPendientes);

    // ---- ranking por atleta ----
    const cuerpoRanking = $<HTMLTableSectionElement>('#cc-ranking-body')!;
    cuerpoRanking.innerHTML = '';
    if (ranking.length === 0 && ventaGenerica === 0) {
      cuerpoRanking.innerHTML = '<tr><td colspan="3" class="cc-vacio">Todavía no hay tickets vendidos.</td></tr>';
    } else {
      ranking.forEach((r) => {
        const fila = document.createElement('tr');
        fila.innerHTML = `<td>${escaparHtml(r.atleta)}</td><td class="cc-mono">${escaparHtml(r.codigo)}</td><td class="cc-num">${r.ticketsVendidos}</td>`;
        cuerpoRanking.appendChild(fila);
      });
      if (ventaGenerica > 0) {
        const fila = document.createElement('tr');
        fila.innerHTML = `<td>Venta genérica (sin link de atleta)</td><td class="cc-mono">—</td><td class="cc-num">${ventaGenerica}</td>`;
        cuerpoRanking.appendChild(fila);
      }
    }

    // ---- listado de ventas ----
    const cuerpoVentas = $<HTMLTableSectionElement>('#cc-ventas-body')!;
    cuerpoVentas.innerHTML = '';
    if (ventas.length === 0) {
      cuerpoVentas.innerHTML = '<tr><td colspan="7" class="cc-vacio">Todavía no hay ventas registradas.</td></tr>';
    } else {
      ventas.forEach((v) => {
        const fila = document.createElement('tr');
        fila.innerHTML = `
          <td>${formatearFecha(v.paidAt ?? v.createdAt)}</td>
          <td>${escaparHtml(v.compradorNombre)}<br><span class="cc-sub">${escaparHtml(v.compradorEmail)} · ${escaparHtml(v.compradorTelefono)}</span></td>
          <td class="cc-num">${v.cantidadNumeros}</td>
          <td class="cc-num">${formatearMonto(v.monto)}</td>
          <td>${v.atletaNombre ? escaparHtml(v.atletaNombre) : '<span class="cc-sub">Venta genérica</span>'}</td>
          <td><span class="cc-badge cc-badge--${v.estado.toLowerCase()}">${ETIQUETA_ESTADO[v.estado] ?? v.estado}</span></td>
          <td class="cc-mono cc-sub">${escaparHtml(v.commerceOrder)}</td>
        `;
        cuerpoVentas.appendChild(fila);
      });
    }

    $('#cc-cargando')?.setAttribute('hidden', '');
    $('#cc-contenido')?.removeAttribute('hidden');
  } catch (err) {
    console.error(err);
    mostrarError('No pudimos cargar los datos del concurso. Recarga la página o inténtalo más tarde.');
  }
}

function escaparHtml(texto: string): string {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}
