// /pagar/resultado?pago=…: consulta el estado real del pago (nunca confía en la URL de retorno).

import { CLAVE_TOKEN } from './pagar.ts';

function $<T extends Element>(s: string): T {
  return document.querySelector<T>(s)!;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function iniciarResultadoPago(): Promise<void> {
  const pago = new URLSearchParams(location.search).get('pago') ?? '';
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(CLAVE_TOKEN);
  } catch {
    token = null;
  }
  const volver = $<HTMLAnchorElement>('#pr-volver');
  if (token) {
    volver.href = `/pagar?t=${encodeURIComponent(token)}`;
    volver.hidden = false;
  }

  let estado = 'PENDIENTE';
  let total = 0;
  for (let intento = 0; intento < 8; intento++) {
    try {
      const r = await fetch(`/api/pagar/resultado?pago=${encodeURIComponent(pago)}`);
      if (r.ok) {
        const d = (await r.json()) as { estado: string; total: number };
        estado = d.estado;
        total = d.total;
        if (estado !== 'PENDIENTE') break;
      }
    } catch {
      /* se reintenta */
    }
    await espera(2500);
  }

  $<HTMLElement>('#pr-cargando').hidden = true;
  if (estado === 'APROBADO') {
    $<HTMLElement>('#pr-total').textContent = `$${total.toLocaleString('es-CL')}`;
    $<HTMLElement>('#pr-aprobado').hidden = false;
  } else if (estado === 'PENDIENTE') {
    $<HTMLElement>('#pr-pendiente').hidden = false;
  } else {
    $<HTMLElement>('#pr-rechazado').hidden = false;
  }
}
