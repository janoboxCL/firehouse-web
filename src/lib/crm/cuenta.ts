// Reglas de la cuenta corriente familiar (migración 0011). Lógica pura,
// compartida por el servidor (Functions), la página /pagar y el panel.

export type ConceptoCobro = 'INSCRIPCION' | 'MENSUALIDAD' | 'UNIFORME' | 'PACK_COMPETITIVO' | 'CARGO_MANUAL';
export type EstadoCargo = 'PENDIENTE' | 'PARCIAL' | 'PAGADO' | 'ANULADO';

export interface CargoSaldo {
  id: string;
  atleta_id: string | null;
  concepto_codigo: ConceptoCobro;
  periodo: string | null; // YYYY-MM-01
  descripcion: string;
  monto: number;
  saldo: number;
  vencimiento: string | null; // YYYY-MM-DD
  estado: EstadoCargo;
}

/** Proporción de la mensualidad según la semana del mes de la primera clase (acordado para Star). */
export const PRORRATEO_SEMANA = [1, 0.75, 0.5, 0.25] as const;

export function semanaDelMes(fechaISO: string): number {
  const dia = Number(fechaISO.slice(8, 10));
  return Math.min(4, Math.ceil(dia / 7));
}

export function mensualidadProrrateada(mensualidad: number, fechaPrimeraClase: string): number {
  return Math.round(mensualidad * PRORRATEO_SEMANA[semanaDelMes(fechaPrimeraClase) - 1]);
}

export function periodoDe(fechaISO: string): string {
  return `${fechaISO.slice(0, 7)}-01`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function nombreMes(periodo: string): string {
  return `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;
}

/** Vencimiento de la mensualidad: el día 5 del mes. */
export function vencimientoMensualidad(periodo: string): string {
  return `${periodo.slice(0, 7)}-05`;
}

export function descripcionInscripcionStar(temporada: number): string {
  return `Inscripción Firehouse Star ${temporada} · Kit de Iniciación (polera y scrunchie)`;
}

export function descripcionMensualidad(programa: string, periodo: string, prorrateada: boolean): string {
  return `Mensualidad ${programa} · ${nombreMes(periodo)}${prorrateada ? ' (proporcional)' : ''}`;
}

/** Cargos que se pueden pagar ahora, con lo que la página marca por defecto y lo que exige. */
export interface CargoPagable extends CargoSaldo {
  sugerido: boolean;
  obligatorio: boolean;
}

export function cargosPagables(cargos: CargoSaldo[], hoy: string): CargoPagable[] {
  const abiertos = cargos
    .filter((c) => (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL') && c.saldo > 0)
    .sort((a, b) => (a.vencimiento ?? a.periodo ?? '').localeCompare(b.vencimiento ?? b.periodo ?? ''));
  const vencidaMasAntigua = abiertos.find((c) => c.concepto_codigo === 'MENSUALIDAD' && !!c.vencimiento && c.vencimiento < hoy);
  return abiertos.map((c) => {
    const obligatorio = c.id === vencidaMasAntigua?.id;
    const vencida = !!c.vencimiento && c.vencimiento < hoy;
    const sugerido = obligatorio || c.concepto_codigo === 'INSCRIPCION' || c.concepto_codigo === 'CARGO_MANUAL' || (c.concepto_codigo === 'MENSUALIDAD' && vencida);
    return { ...c, sugerido, obligatorio };
  });
}

export type ResultadoSeleccion = { ok: true; total: number } | { ok: false; error: string };

export function validarSeleccion(pagables: CargoPagable[], ids: string[]): ResultadoSeleccion {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { ok: false, error: 'Selecciona al menos un concepto.' };
  const elegidos = pagables.filter((c) => unicos.includes(c.id));
  if (elegidos.length !== unicos.length) return { ok: false, error: 'Algún concepto ya no está disponible. Recarga la página.' };
  const obligatorio = pagables.find((c) => c.obligatorio);
  if (obligatorio && !unicos.includes(obligatorio.id)) {
    return { ok: false, error: `Debes incluir ${obligatorio.descripcion}, que está vencida.` };
  }
  return { ok: true, total: elegidos.reduce((s, c) => s + c.saldo, 0) };
}

export function generarCommerceOrder(ahora = Date.now()): string {
  const azar = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `PAGO-${ahora.toString(36).toUpperCase()}-${azar.toUpperCase()}`;
}

/** Token secreto del link familiar: 32 bytes aleatorios en base64url (43 caracteres). */
export function generarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function tokenValido(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function urlCuenta(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/pagar?t=${token}`;
}
