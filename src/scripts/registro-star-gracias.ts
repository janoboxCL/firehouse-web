// Lógica de cliente para /registro-star/gracias. Mismo patrón que
// campana-2026-descarga.ts: nunca confía en la URL de retorno de la
// pasarela, siempre vuelve a preguntar acá el estado real — y reintenta
// unas pocas veces porque el webhook puede tardar unos segundos más que
// la redirección.

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

interface RespuestaOrden {
  estado: string;
  apoderadoNombre?: string;
  atletaNombre?: string;
  monto?: number;
}

const REINTENTOS = [2000, 3000, 5000, 8000];

function mostrarBloque(id: string): void {
  ['rsgEstado-cargando', 'rsgEstado-pagada', 'rsgEstado-pendiente', 'rsgEstado-rechazada', 'rsgEstado-error'].forEach((otro) =>
    $<HTMLElement>(`#${otro}`)?.setAttribute('hidden', ''),
  );
  $<HTMLElement>(`#${id}`)?.removeAttribute('hidden');
}

function renderPagada(data: RespuestaOrden): void {
  const nombreAtleta = $<HTMLElement>('#rsgAtleta');
  if (nombreAtleta && data.atletaNombre) nombreAtleta.textContent = data.atletaNombre.split(' ')[0];
  mostrarBloque('rsgEstado-pagada');
}

async function consultar(ordenId: string, intento: number): Promise<void> {
  try {
    const res = await fetch(`/api/registro-star/orden?orden=${encodeURIComponent(ordenId)}`);
    const data = (await res.json()) as RespuestaOrden;

    if (res.status === 200 && data.estado === 'PAGADA') {
      renderPagada(data);
      return;
    }

    if (res.status === 202) {
      if (intento < REINTENTOS.length) {
        mostrarBloque('rsgEstado-pendiente');
        setTimeout(() => consultar(ordenId, intento + 1), REINTENTOS[intento]);
      } else {
        mostrarBloque('rsgEstado-pendiente');
        $<HTMLElement>('#rsgReintentarBtn')?.removeAttribute('hidden');
      }
      return;
    }

    mostrarBloque('rsgEstado-rechazada');
  } catch {
    mostrarBloque('rsgEstado-error');
  }
}

export function iniciarGraciasStar(): void {
  const ordenId = new URLSearchParams(window.location.search).get('orden');
  if (!ordenId) {
    mostrarBloque('rsgEstado-error');
    return;
  }

  $('#rsgReintentarBtn')?.addEventListener('click', () => {
    mostrarBloque('rsgEstado-cargando');
    consultar(ordenId, REINTENTOS.length);
  });

  consultar(ordenId, 0);
}
