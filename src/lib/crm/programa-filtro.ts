// Selector de programa del CRM (Todos · All Star · Star · Sin programa).
// Se recuerda entre páginas y sesiones del mismo navegador.

export type SeleccionPrograma = 'TODOS' | 'ALL_STAR' | 'STAR' | 'SIN_PROGRAMA';

export const OPCIONES_PROGRAMA: Array<{ valor: SeleccionPrograma; etiqueta: string }> = [
  { valor: 'TODOS', etiqueta: 'Todos' },
  { valor: 'ALL_STAR', etiqueta: 'Firehouse All Star' },
  { valor: 'STAR', etiqueta: 'Firehouse Star' },
  { valor: 'SIN_PROGRAMA', etiqueta: 'Sin programa' },
];

const CLAVE = 'fh-crm-programa';

export function coincidePrograma(programa: string | null | undefined, seleccion: SeleccionPrograma): boolean {
  if (seleccion === 'TODOS') return true;
  if (seleccion === 'SIN_PROGRAMA') return !programa;
  return programa === seleccion;
}

export function contarPorPrograma(casos: Array<{ programa?: string | null }>): Record<SeleccionPrograma, number> {
  const conteo: Record<SeleccionPrograma, number> = { TODOS: casos.length, ALL_STAR: 0, STAR: 0, SIN_PROGRAMA: 0 };
  for (const c of casos) {
    if (c.programa === 'ALL_STAR') conteo.ALL_STAR += 1;
    else if (c.programa === 'STAR') conteo.STAR += 1;
    else conteo.SIN_PROGRAMA += 1;
  }
  return conteo;
}

export function leerSeleccion(): SeleccionPrograma {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v && OPCIONES_PROGRAMA.some((o) => o.valor === v)) return v as SeleccionPrograma;
  } catch {
    /* sin almacenamiento disponible */
  }
  return 'TODOS';
}

export function guardarSeleccion(v: SeleccionPrograma): void {
  try {
    localStorage.setItem(CLAVE, v);
  } catch {
    /* sin almacenamiento disponible */
  }
}

/** Dibuja el selector como pestañas con conteo. `ocultar` permite quitar opciones (ej. Sin programa). */
export function montarSelectorPrograma(
  contenedor: HTMLElement,
  conteo: Record<SeleccionPrograma, number>,
  actual: SeleccionPrograma,
  onCambio: (v: SeleccionPrograma) => void,
  ocultar: SeleccionPrograma[] = [],
): void {
  contenedor.setAttribute('role', 'tablist');
  contenedor.innerHTML = OPCIONES_PROGRAMA.filter((o) => !ocultar.includes(o.valor) && (o.valor !== 'SIN_PROGRAMA' || conteo.SIN_PROGRAMA > 0))
    .map(
      (o) => `<button type="button" role="tab" class="fh-programa__tab fh-programa__tab--${o.valor.toLowerCase()}"
        aria-selected="${o.valor === actual}" data-programa="${o.valor}">${o.etiqueta}
        <span class="fh-programa__conteo">${conteo[o.valor]}</span></button>`,
    )
    .join('');
  contenedor.onclick = (evt) => {
    const b = (evt.target as HTMLElement).closest<HTMLButtonElement>('button[data-programa]');
    if (!b) return;
    const v = b.dataset.programa as SeleccionPrograma;
    guardarSeleccion(v);
    contenedor.querySelectorAll('button[data-programa]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    onCambio(v);
  };
}
