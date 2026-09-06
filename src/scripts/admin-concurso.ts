import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import {
  obtenerResumenConcurso,
  obtenerVentasConcurso,
  obtenerAtletasConLinks,
  generarCodigosFaltantes,
  type AtletaLinkConcurso,
} from '../lib/crm/admin-concurso-api.ts';

const SITIO_URL = 'https://firehousecheer.cl';

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
    const [resumen, ventas] = await Promise.all([obtenerResumenConcurso(supabase), obtenerVentasConcurso(supabase)]);

    // ---- tarjetas de resumen ----
    $('#cc-vendidos')!.textContent = `${resumen.vendidos} / ${resumen.totalNumeros}`;
    $('#cc-recaudado')!.textContent = formatearMonto(resumen.recaudado);
    $('#cc-reservados')!.textContent = String(resumen.reservados);
    $('#cc-pendientes')!.textContent = String(resumen.ventasPendientes);

    // ---- links por atleta ----
    await cargarYRenderizarAtletas(supabase);

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

    $<HTMLButtonElement>('#cc-generar-codigos')!.addEventListener('click', async (evt) => {
      const boton = evt.currentTarget as HTMLButtonElement;
      const mensaje = $<HTMLElement>('#cc-generar-mensaje')!;
      boton.disabled = true;
      boton.textContent = 'Generando…';
      try {
        const creados = await generarCodigosFaltantes(supabase);
        mensaje.hidden = false;
        mensaje.textContent =
          creados > 0
            ? `Se generaron ${creados} código${creados > 1 ? 's' : ''} nuevo${creados > 1 ? 's' : ''}.`
            : 'Todos los atletas ya tenían código.';
        await cargarYRenderizarAtletas(supabase);
      } catch {
        mensaje.hidden = false;
        mensaje.textContent = 'No pudimos generar los códigos. Inténtalo de nuevo.';
      } finally {
        boton.disabled = false;
        boton.textContent = 'Generar códigos faltantes';
      }
    });

    $('#cc-cargando')?.setAttribute('hidden', '');
    $('#cc-contenido')?.removeAttribute('hidden');
  } catch (err) {
    console.error(err);
    mostrarError('No pudimos cargar los datos del concurso. Recarga la página o inténtalo más tarde.');
  }
}

async function cargarYRenderizarAtletas(supabase: Parameters<typeof obtenerAtletasConLinks>[0]): Promise<void> {
  const { atletas, ventaGenerica } = await obtenerAtletasConLinks(supabase);
  renderAtletas(atletas, ventaGenerica);
}

function renderAtletas(atletas: AtletaLinkConcurso[], ventaGenerica: number): void {
  const cuerpo = $<HTMLTableSectionElement>('#cc-atletas-body')!;
  cuerpo.innerHTML = '';

  atletas.forEach((a) => {
    const fila = document.createElement('tr');
    const meta = a.metaMinima || 1;
    const porcentaje = Math.min(100, Math.round((a.ticketsVendidos / meta) * 100));
    const cumplida = a.ticketsVendidos >= a.metaMinima;
    const link = a.codigo ? `${SITIO_URL}/sorteo?ref=${a.codigo}` : '';

    fila.innerHTML = `
      <td>${escaparHtml(a.nombreCompleto)}</td>
      <td>
        ${
          a.codigo
            ? `<div class="cc-link-row">
                 <code title="${escaparHtml(link)}">${escaparHtml(link)}</code>
                 <button type="button" class="cc-link-btn" data-copiar="${escaparHtml(link)}">Copiar</button>
                 <button type="button" class="cc-link-btn" data-whatsapp="${escaparHtml(link)}" data-nombre="${escaparHtml(a.nombreCompleto.split(' ')[0])}">WhatsApp</button>
               </div>`
            : '<span class="cc-sin-codigo">Sin código todavía</span>'
        }
      </td>
      <td class="cc-progreso">
        <p class="cc-progreso__texto">${a.ticketsVendidos} / ${a.metaMinima}</p>
        <div class="cc-progreso__barra"><div class="cc-progreso__relleno${cumplida ? ' cc-progreso__relleno--cumplida' : ''}" style="width:${porcentaje}%"></div></div>
      </td>
      <td></td>
    `;
    cuerpo.appendChild(fila);
  });

  if (ventaGenerica > 0) {
    const fila = document.createElement('tr');
    fila.innerHTML = `<td colspan="3">Venta genérica (sin link de ningún atleta)</td><td class="cc-num">${ventaGenerica}</td>`;
    cuerpo.appendChild(fila);
  }

  cuerpo.querySelectorAll<HTMLButtonElement>('[data-copiar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(btn.dataset.copiar || '');
      const original = btn.textContent;
      btn.textContent = '¡Copiado!';
      setTimeout(() => (btn.textContent = original), 1500);
    });
  });

  cuerpo.querySelectorAll<HTMLButtonElement>('[data-whatsapp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mensaje = `🔥 ¡Hola! Te comparto el link de ${btn.dataset.nombre} para el Gran Concurso Firehouse. ¡Cada ticket ayuda! ${btn.dataset.whatsapp}`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`, '_blank');
    });
  });
}

function escaparHtml(texto: string): string {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}
