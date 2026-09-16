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
  atletaNombres?: string[];
  monto?: number;
}

function textoNombres(nombres: string[]): string {
  const primeros = nombres.map((n) => n.split(' ')[0]);
  if (primeros.length === 1) return primeros[0];
  if (primeros.length === 2) return `${primeros[0]} y ${primeros[1]}`;
  return `${primeros.slice(0, -1).join(', ')} y ${primeros[primeros.length - 1]}`;
}

const REINTENTOS = [2000, 3000, 5000, 8000];

function mostrarBloque(id: string): void {
  ['rsgEstado-cargando', 'rsgEstado-pagada', 'rsgEstado-pendiente', 'rsgEstado-rechazada', 'rsgEstado-error'].forEach((otro) =>
    $<HTMLElement>(`#${otro}`)?.setAttribute('hidden', ''),
  );
  $<HTMLElement>(`#${id}`)?.removeAttribute('hidden');
}

function renderPagada(data: RespuestaOrden): void {
  const nombreAtletas = $<HTMLElement>('#rsgAtleta');
  if (nombreAtletas && data.atletaNombres && data.atletaNombres.length > 0) {
    nombreAtletas.textContent = textoNombres(data.atletaNombres);
  }
  const verbo = $<HTMLElement>('#rsgVerbo');
  if (verbo) verbo.textContent = (data.atletaNombres?.length ?? 1) > 1 ? 'ya tienen' : 'ya tiene';
  mostrarBloque('rsgEstado-pagada');
}

async function consultar(ordenId: string, pagoId: string, intento: number): Promise<void> {
  try {
    const params = new URLSearchParams({ orden: ordenId });
    if (pagoId) params.set('pago', pagoId);
    const res = await fetch(`/api/registro-star/orden?${params.toString()}`);
    const data = (await res.json()) as RespuestaOrden;

    if (res.status === 200 && data.estado === 'PAGADA') {
      renderPagada(data);
      return;
    }

    if (res.status === 202) {
      if (intento < REINTENTOS.length) {
        mostrarBloque('rsgEstado-pendiente');
        setTimeout(() => consultar(ordenId, pagoId, intento + 1), REINTENTOS[intento]);
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
  const query = new URLSearchParams(window.location.search);
  const ordenId = query.get('orden');
  // Mercado Pago agrega payment_id (o collection_id en algunos retornos)
  // a la back_url. El backend lo usa sólo para consultar la pasarela y
  // exige que pertenezca exactamente a esta orden STAR.
  const pagoId = query.get('payment_id') ?? query.get('collection_id') ?? '';
  if (!ordenId) {
    mostrarBloque('rsgEstado-error');
    return;
  }

  $('#rsgReintentarBtn')?.addEventListener('click', () => {
    mostrarBloque('rsgEstado-cargando');
    consultar(ordenId, pagoId, REINTENTOS.length);
  });

  consultar(ordenId, pagoId, 0);
}
