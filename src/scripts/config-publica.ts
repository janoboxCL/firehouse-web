// Actualiza en las páginas públicas los valores que se editan en el CRM
// (precios y horario de Firehouse Star). El HTML ya trae el valor de respaldo:
// si la consulta falla, la página se ve igual que antes.
//
// Marcas: data-cfg="star-matricula | star-mensualidad | star-primer-mes |
//                    star-horario | star-prorrateo-1..4"

export interface ConfigPublica {
  star?: {
    matricula: number;
    mensualidad: number;
    prorrateo: number[];
    horaInicio: string;
    horaFin: string;
    proximaClase: string;
  };
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;

let promesa: Promise<ConfigPublica | null> | null = null;

export function obtenerConfigPublica(): Promise<ConfigPublica | null> {
  promesa ??= fetch('/api/config/publica')
    .then((r) => (r.ok ? (r.json() as Promise<ConfigPublica>) : null))
    .catch(() => null);
  return promesa;
}

export async function aplicarConfigPublica(): Promise<void> {
  const c = await obtenerConfigPublica();
  const s = c?.star;
  if (!s || !s.matricula || !s.mensualidad) return;
  const valores: Record<string, string> = {
    'star-matricula': pesos(s.matricula),
    'star-mensualidad': pesos(s.mensualidad),
    'star-primer-mes': pesos(s.matricula + s.mensualidad),
    'star-horario': `${s.horaInicio}–${s.horaFin}`,
  };
  (s.prorrateo ?? []).forEach((m, i) => (valores[`star-prorrateo-${i + 1}`] = pesos(m)));
  document.querySelectorAll<HTMLElement>('[data-cfg]').forEach((el) => {
    const v = valores[el.dataset.cfg ?? ''];
    if (v) el.textContent = v;
  });
}
