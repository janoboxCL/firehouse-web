// Lógica de cliente para /campana-2026/descarga.
//
// Reintenta unas pocas veces con espera creciente porque el webhook de Flow
// puede tardar unos segundos más que la redirección del propio Flow — así
// alguien que vuelve del pago no ve "rechazado" solo por haber llegado un
// poco antes que la confirmación.

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

interface ProductoDescarga {
  producto: string;
  nombre: string;
  urlDescarga: string;
}

interface RespuestaOrden {
  estado: string;
  compradorNombre?: string;
  productos?: ProductoDescarga[];
  codigos?: string[];
}

const REINTENTOS = [2000, 3000, 5000, 8000];

function mostrarBloque(id: string): void {
  ['dgEstado-cargando', 'dgEstado-pagada', 'dgEstado-pendiente', 'dgEstado-rechazada', 'dgEstado-error']
    .forEach((otro) => $<HTMLElement>(`#${otro}`)?.setAttribute('hidden', ''));
  $<HTMLElement>(`#${id}`)?.removeAttribute('hidden');
}

function renderPagada(data: RespuestaOrden): void {
  const nombre = $<HTMLElement>('#dgNombre');
  if (nombre && data.compradorNombre) nombre.textContent = data.compradorNombre.split(' ')[0];

  const listaProductos = $<HTMLElement>('#dgProductos');
  if (listaProductos) {
    listaProductos.innerHTML = '';
    (data.productos ?? []).forEach((p) => {
      const item = document.createElement('div');
      item.className = 'dg-producto';
      const nombreEl = document.createElement('p');
      nombreEl.className = 'dg-producto__nombre';
      nombreEl.textContent = p.nombre;
      const btn = document.createElement('a');
      btn.className = 'btn';
      btn.href = p.urlDescarga;
      btn.textContent = 'Descargar';
      btn.setAttribute('download', '');
      item.appendChild(nombreEl);
      item.appendChild(btn);
      listaProductos.appendChild(item);
    });
  }

  const listaCodigos = $<HTMLElement>('#dgCodigos');
  if (listaCodigos) {
    listaCodigos.innerHTML = '';
    (data.codigos ?? []).forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'dg-codigo';
      chip.textContent = c;
      listaCodigos.appendChild(chip);
    });
  }

  mostrarBloque('dgEstado-pagada');
}

async function consultar(ordenId: string, intento: number): Promise<void> {
  try {
    const res = await fetch(`/api/campana-2026/orden?orden=${encodeURIComponent(ordenId)}`);
    const data = (await res.json()) as RespuestaOrden;

    if (res.status === 200 && data.estado === 'PAGADA') {
      renderPagada(data);
      return;
    }

    if (res.status === 202) {
      if (intento < REINTENTOS.length) {
        mostrarBloque('dgEstado-pendiente');
        setTimeout(() => consultar(ordenId, intento + 1), REINTENTOS[intento]);
      } else {
        // Se acabaron los reintentos automáticos, pero seguimos ofreciendo
        // reintentar a mano — la confirmación puede demorar más en casos raros.
        mostrarBloque('dgEstado-pendiente');
        $<HTMLElement>('#dgReintentarBtn')?.removeAttribute('hidden');
      }
      return;
    }

    mostrarBloque('dgEstado-rechazada');
  } catch {
    mostrarBloque('dgEstado-error');
  }
}

export function iniciarDescargaCampana2026(): void {
  const ordenId = new URLSearchParams(window.location.search).get('orden');
  if (!ordenId) {
    mostrarBloque('dgEstado-error');
    return;
  }

  $('#dgReintentarBtn')?.addEventListener('click', () => {
    mostrarBloque('dgEstado-cargando');
    consultar(ordenId, REINTENTOS.length);
  });

  consultar(ordenId, 0);
}
