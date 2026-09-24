// Cliente del panel para /api/admin/cuenta (cuenta corriente familiar).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CargoPanel {
  id: string;
  atleta_id: string | null;
  atleta_nombre: string | null;
  concepto_codigo: string;
  descripcion: string;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: 'PENDIENTE' | 'PARCIAL' | 'PAGADO' | 'ANULADO';
}

export interface PagoPanel {
  id: string;
  commerce_order: string;
  medio: string;
  monto_total: number;
  estado: string;
  referencia: string | null;
  aprobado_at: string | null;
  created_at: string;
  detalle: Array<{ cargo_id: string; monto: number }>;
}

export interface CuentaPanel {
  link: string | null;
  atletas: Array<{ id: string; nombre: string }>;
  cargos: CargoPanel[];
  pagos: PagoPanel[];
  comprobante?: boolean;
}

async function llamar<T>(supabase: SupabaseClient, metodo: 'GET' | 'POST', cuerpo?: unknown, query = ''): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  const r = await fetch(`/api/admin/cuenta${query}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const d = (await r.json().catch(() => ({}))) as T & { mensaje?: string; error?: string };
  if (!r.ok) throw new Error(d.mensaje ?? d.error ?? `Error ${r.status}`);
  return d;
}

export const obtenerCuenta = (s: SupabaseClient, apoderadoId: string) =>
  llamar<CuentaPanel>(s, 'GET', undefined, `?apoderadoId=${encodeURIComponent(apoderadoId)}`);

export const generarLinkPago = (s: SupabaseClient, datos: { apoderadoId?: string; atletaId?: string }) =>
  llamar<{ url: string; creados: string[]; aviso: string | null }>(s, 'POST', { accion: 'generar_link', ...datos });

export const registrarPagoManual = (s: SupabaseClient, apoderadoId: string, cargoIds: string[], medio: string, referencia: string) =>
  llamar<CuentaPanel>(s, 'POST', { accion: 'pago_manual', apoderadoId, cargoIds, medio, referencia });

export const anularCargo = (s: SupabaseClient, cargoId: string, motivo: string) =>
  llamar<CuentaPanel>(s, 'POST', { accion: 'anular_cargo', cargoId, motivo });

export const revocarLink = (s: SupabaseClient, apoderadoId: string) =>
  llamar<CuentaPanel>(s, 'POST', { accion: 'revocar_link', apoderadoId });
