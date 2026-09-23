// Estado de la Campaña 2026 para el panel: si está vendiendo, qué falta para
// habilitarla y los valores oficiales definidos en las bases publicadas.
// Lógica pura, compartida por el endpoint /api/admin/campana-estado y el panel.

/** Valores de las bases versión 2026-1.0 (firehousecheer.cl/campana-2026/bases). */
export const BASES_OFICIALES = {
  basesVersion: '2026-1.0',
  privacyVersion: '2026-1.0',
  inicio: '2026-10-01T00:00:00-03:00',
  cierre: '2026-12-11T23:59:59-03:00',
  sorteo: '2026-12-12T20:00:00-03:00',
  premios: [{ lugar: 1, descripcion: '$100.000 (cien mil pesos chilenos)' }],
  proveedorPago: 'MERCADOPAGO',
} as const;

export interface ConfigCampana {
  checkout_habilitado: boolean;
  participacion_habilitada: boolean;
  bases_version: string | null;
  privacy_version: string | null;
  inicio_at: string | null;
  cierre_at: string | null;
  sorteo_at: string | null;
  premios: unknown;
  proveedor_pago: string | null;
  email_configurado: boolean;
  schema_version: number | null;
}

export interface Chequeo {
  id: string;
  label: string;
  ok: boolean;
  detalle?: string;
}

export interface EntornoCampana {
  secretoIdentidad: boolean;
  correoServidor: boolean;
  pasarelaHabilitada: boolean;
  participacionesAnterioresActivas: number;
  sorteoCerrado: boolean;
}

export type EstadoCampana = 'ABIERTA' | 'FUERA_DE_PERIODO' | 'CERRADA' | 'SORTEO_CERRADO';

export function mismoInstante(a: string | null, b: string): boolean {
  return a !== null && Date.parse(a) === Date.parse(b);
}

export function enPeriodo(c: Pick<ConfigCampana, 'inicio_at' | 'cierre_at'>, ahora: number): boolean {
  if (!c.inicio_at || !c.cierre_at) return false;
  return ahora >= Date.parse(c.inicio_at) && ahora <= Date.parse(c.cierre_at);
}

export function chequeosCampana(c: ConfigCampana, e: EntornoCampana): Chequeo[] {
  const fechasOk =
    !!c.inicio_at && !!c.cierre_at && !!c.sorteo_at &&
    Date.parse(c.inicio_at) < Date.parse(c.cierre_at) && Date.parse(c.cierre_at) <= Date.parse(c.sorteo_at);
  return [
    { id: 'migracion', label: 'Migración 0005 aplicada', ok: Number(c.schema_version) >= 5 },
    {
      id: 'bases', label: 'Versión de bases y privacidad',
      ok: c.bases_version === BASES_OFICIALES.basesVersion && c.privacy_version === BASES_OFICIALES.privacyVersion,
      detalle: `Debe ser ${BASES_OFICIALES.basesVersion}`,
    },
    { id: 'fechas', label: 'Fechas de inicio, cierre y sorteo', ok: fechasOk },
    { id: 'premios', label: 'Premios definidos', ok: Array.isArray(c.premios) && c.premios.length > 0 },
    { id: 'pasarela', label: 'Pasarela de pago habilitada', ok: !!c.proveedor_pago && e.pasarelaHabilitada },
    {
      id: 'correo', label: 'Correo configurado', ok: c.email_configurado && e.correoServidor,
      detalle: e.correoServidor ? undefined : 'Faltan RESEND_API_KEY o EMAIL_FROM en Cloudflare',
    },
    {
      id: 'secreto', label: 'Secreto de identidad (CAMPAIGN_IDENTITY_SECRET)', ok: e.secretoIdentidad,
      detalle: e.secretoIdentidad ? undefined : 'Créalo en Cloudflare y vuelve a desplegar',
    },
    {
      id: 'anteriores', label: 'Sin participaciones de prueba o anteriores activas',
      ok: e.participacionesAnterioresActivas === 0,
      detalle: e.participacionesAnterioresActivas ? `${e.participacionesAnterioresActivas} activas sin RUT asociado` : undefined,
    },
    { id: 'sorteo', label: 'Sorteo aún no cerrado', ok: !e.sorteoCerrado },
  ];
}

export function estadoCampana(c: ConfigCampana, e: EntornoCampana, ahora: number): EstadoCampana {
  if (e.sorteoCerrado) return 'SORTEO_CERRADO';
  if (!c.checkout_habilitado && !c.participacion_habilitada) return 'CERRADA';
  return enPeriodo(c, ahora) ? 'ABIERTA' : 'FUERA_DE_PERIODO';
}

/** ¿El inicio está adelantado respecto de las bases (modo prueba)? */
export function inicioAdelantado(c: Pick<ConfigCampana, 'inicio_at'>): boolean {
  return !!c.inicio_at && Date.parse(c.inicio_at) < Date.parse(BASES_OFICIALES.inicio);
}

/** Traduce los errores de la base a un mensaje para el panel. */
export function mensajeErrorActivacion(mensaje: string): string {
  if (mensaje.includes('configuracion_incompleta')) return 'Falta configuración: revisa los puntos marcados en rojo.';
  if (mensaje.includes('sin_participante')) return 'Hay participaciones anteriores sin RUT asociado. Invalídalas antes de habilitar.';
  if (mensaje.includes('campana_cerrada')) return 'El sorteo ya se cerró: la campaña no se puede volver a habilitar.';
  return 'No se pudo aplicar el cambio.';
}
