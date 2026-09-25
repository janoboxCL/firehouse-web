// Menú de pagos del panel: una fila por familia y programa (Star o All Star),
// con lo que debe, lo vencido y lo pagado. Lógica pura: la usan el endpoint
// /api/admin/pagos (arma el resumen) y la pantalla /admin/pagos.

export type ProgramaPagos = 'STAR' | 'ALL_STAR';
export type EstadoFamilia = 'VENCIDO' | 'PENDIENTE' | 'SIN_CARGOS' | 'AL_DIA';

export const ESTADO_FAMILIA_LABEL: Record<EstadoFamilia, string> = {
  VENCIDO: 'Con vencidos',
  PENDIENTE: 'Por pagar',
  SIN_CARGOS: 'Sin cargos',
  AL_DIA: 'Al día',
};

export interface ApoderadoFila {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string;
  es_prueba?: boolean | null;
}

export interface AtletaFila {
  id: string;
  apoderado_id: string;
  nombre: string;
  apellidos: string;
}

export interface CargoFila {
  id: string;
  apoderado_id: string;
  atleta_id: string | null;
  concepto_codigo: string;
  descripcion: string;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: string;
}

export interface KitRegistro {
  orden_id: string;
  commerce_order: string;
  atleta_id: string;
  monto: number;
  fecha: string;
  /** true si la orden ya está en la cuenta (pago con el mismo número de orden). */
  registrado: boolean;
}

export interface DetallePago {
  cargo_id: string;
  monto: number;
  estado_pago: string;
  aprobado_at: string | null;
}

export interface EntradaFamilias {
  apoderados: ApoderadoFila[];
  atletas: AtletaFila[];
  /** Estado del caso más reciente de cada deportista en el programa. */
  estadoCaso: Record<string, string>;
  cargos: CargoFila[];
  kits: KitRegistro[];
  links: Record<string, string>;
  ultimoPago: Record<string, string>;
  hoy: string;
}

export interface AtletaFamilia {
  id: string;
  nombre: string;
  estadoCaso: string | null;
  /** Kit pagado en el registro Star: REGISTRADO en la cuenta o PENDIENTE de registrar. */
  kit: 'REGISTRADO' | 'PENDIENTE' | null;
}

export interface FamiliaPagos {
  apoderado: ApoderadoFila;
  nombre: string;
  atletas: AtletaFamilia[];
  abiertos: Array<CargoFila & { vencido: boolean; atleta_nombre: string | null }>;
  totalCargos: number;
  saldo: number;
  vencido: number;
  pagado: number;
  estado: EstadoFamilia;
  kitsSinRegistrar: Array<{ orden_id: string; commerce_order: string; monto: number; fecha: string }>;
  link: string | null;
  ultimoPago: string | null;
}

const ORDEN_ESTADO: Record<EstadoFamilia, number> = { VENCIDO: 0, PENDIENTE: 1, SIN_CARGOS: 2, AL_DIA: 3 };

function primerNombre(n: string): string {
  return (n ?? '').trim().split(/\s+/)[0] ?? '';
}

export function estaAbierto(c: Pick<CargoFila, 'estado' | 'saldo'>): boolean {
  return (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL') && c.saldo > 0;
}

export function estaVencido(c: Pick<CargoFila, 'estado' | 'saldo' | 'vencimiento'>, hoy: string): boolean {
  return estaAbierto(c) && !!c.vencimiento && c.vencimiento < hoy;
}

/** Arma una fila por familia, ordenadas: con vencidos, por pagar, sin cargos, al día. */
export function armarFamilias(e: EntradaFamilias): FamiliaPagos[] {
  const nombreAtleta = new Map(e.atletas.map((a) => [a.id, primerNombre(a.nombre)]));
  const familias = new Map<string, FamiliaPagos>();

  for (const ap of e.apoderados) {
    familias.set(ap.id, {
      apoderado: ap,
      nombre: `${ap.nombre} ${ap.apellidos}`.trim(),
      atletas: [],
      abiertos: [],
      totalCargos: 0,
      saldo: 0,
      vencido: 0,
      pagado: 0,
      estado: 'SIN_CARGOS',
      kitsSinRegistrar: [],
      link: e.links[ap.id] ?? null,
      ultimoPago: e.ultimoPago[ap.id] ?? null,
    });
  }

  const kitsPorAtleta = new Map<string, KitRegistro[]>();
  e.kits.forEach((k) => kitsPorAtleta.set(k.atleta_id, [...(kitsPorAtleta.get(k.atleta_id) ?? []), k]));

  for (const a of e.atletas) {
    const f = familias.get(a.apoderado_id);
    if (!f) continue;
    const kits = kitsPorAtleta.get(a.id) ?? [];
    const kit = kits.length === 0 ? null : kits.every((k) => k.registrado) ? 'REGISTRADO' : 'PENDIENTE';
    f.atletas.push({ id: a.id, nombre: primerNombre(a.nombre), estadoCaso: e.estadoCaso[a.id] ?? null, kit });
    for (const k of kits) {
      if (!k.registrado && !f.kitsSinRegistrar.some((x) => x.orden_id === k.orden_id)) {
        f.kitsSinRegistrar.push({ orden_id: k.orden_id, commerce_order: k.commerce_order, monto: k.monto, fecha: k.fecha });
      }
    }
  }

  for (const c of e.cargos) {
    const f = familias.get(c.apoderado_id);
    if (!f || c.estado === 'ANULADO') continue;
    f.totalCargos += 1;
    f.pagado += c.monto - c.saldo;
    if (estaAbierto(c)) {
      const vencido = estaVencido(c, e.hoy);
      f.abiertos.push({ ...c, vencido, atleta_nombre: c.atleta_id ? nombreAtleta.get(c.atleta_id) ?? null : null });
      f.saldo += c.saldo;
      if (vencido) f.vencido += c.saldo;
    }
  }

  for (const f of familias.values()) {
    f.estado = f.vencido > 0 ? 'VENCIDO' : f.saldo > 0 ? 'PENDIENTE' : f.totalCargos === 0 ? 'SIN_CARGOS' : 'AL_DIA';
    f.abiertos.sort((a, b) => (a.vencimiento ?? '9999').localeCompare(b.vencimiento ?? '9999'));
    f.atletas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  return [...familias.values()].sort(
    (a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

export interface TotalesPagos {
  familias: number;
  conDeuda: number;
  porCobrar: number;
  vencido: number;
  recaudadoMes: number;
  familiasPrueba: number;
}

/** Totales del programa. Las familias de prueba no cuentan. */
export function totalesPagos(familias: FamiliaPagos[], detalles: DetallePago[], cargosDePrueba: Set<string>, hoy: string): TotalesPagos {
  const reales = familias.filter((f) => !f.apoderado.es_prueba);
  const mes = hoy.slice(0, 7);
  const recaudadoMes = detalles
    .filter((d) => d.estado_pago === 'APROBADO' && !cargosDePrueba.has(d.cargo_id) && mesChile(d.aprobado_at) === mes)
    .reduce((s, d) => s + d.monto, 0);
  return {
    familias: reales.length,
    conDeuda: reales.filter((f) => f.saldo > 0).length,
    porCobrar: reales.reduce((s, f) => s + f.saldo, 0),
    vencido: reales.reduce((s, f) => s + f.vencido, 0),
    recaudadoMes,
    familiasPrueba: familias.length - reales.length,
  };
}

/** "2026-10" en hora de Chile a partir de un timestamp. */
export function mesChile(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
}

// ---------------------------------------------------------------------------
// Cargo manual

export const CONCEPTOS_MANUALES = {
  UNIFORME: 'Uniforme',
  PACK_COMPETITIVO: 'Pack competitivo',
  CARGO_MANUAL: 'Otro cargo',
} as const;
export type ConceptoManual = keyof typeof CONCEPTOS_MANUALES;

export interface CargoManual {
  apoderadoId: string;
  atletaId: string | null;
  programa: ProgramaPagos;
  concepto: ConceptoManual;
  descripcion: string;
  monto: number;
  vencimiento: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esProgramaPagos(v: unknown): v is ProgramaPagos {
  return v === 'STAR' || v === 'ALL_STAR';
}

export function validarCargoManual(b: Record<string, unknown>): { ok: true; valor: CargoManual } | { ok: false; error: string } {
  const apoderadoId = String(b.apoderadoId ?? '');
  const atletaId = b.atletaId ? String(b.atletaId) : null;
  const programa = b.programa;
  const concepto = String(b.concepto ?? '');
  const descripcion = String(b.descripcion ?? '').trim().replace(/\s+/g, ' ');
  const monto = Number(b.monto);
  const vencimiento = b.vencimiento ? String(b.vencimiento) : null;
  if (!UUID.test(apoderadoId)) return { ok: false, error: 'Elige la familia.' };
  if (atletaId !== null && !UUID.test(atletaId)) return { ok: false, error: 'Deportista no válido.' };
  if (!esProgramaPagos(programa)) return { ok: false, error: 'Elige el programa.' };
  if (!(concepto in CONCEPTOS_MANUALES)) return { ok: false, error: 'Elige el tipo de cargo.' };
  if (concepto === 'PACK_COMPETITIVO' && programa !== 'ALL_STAR') return { ok: false, error: 'El pack competitivo es solo para All Star.' };
  if (descripcion.length < 3 || descripcion.length > 200) return { ok: false, error: 'Escribe una descripción (3 a 200 caracteres).' };
  if (!Number.isInteger(monto) || monto < 1 || monto > 2_000_000) return { ok: false, error: 'El monto debe ser un número entero entre $1 y $2.000.000.' };
  if (vencimiento !== null && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) return { ok: false, error: 'Fecha de vencimiento no válida.' };
  return { ok: true, valor: { apoderadoId, atletaId, programa, concepto: concepto as ConceptoManual, descripcion, monto, vencimiento } };
}

/** Texto para buscar familias sin romper el filtro de PostgREST. */
export function textoBusqueda(v: unknown): string {
  return String(v ?? '').replace(/[^\p{L}\p{N}@.+\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Minúsculas y sin tildes, para comparar nombres. */
export function normalizarBusqueda(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function mensajeLinkPago(nombreApoderado: string, url: string): string {
  return `¡Hola, ${primerNombre(nombreApoderado)}! Este es el link de tu página de pagos Firehouse: ${url}\nAhí puedes ver y pagar lo pendiente. Guárdalo: es el mismo cada mes.`;
}
