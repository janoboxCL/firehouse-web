// Cliente del panel para /api/admin/pagos (menú de pagos).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamiliaPagos, ProgramaPagos, TotalesPagos } from './pagos-panel.ts';

export interface ResumenPagos {
  programa: ProgramaPagos;
  hoy: string;
  familias: FamiliaPagos[];
  totales: TotalesPagos;
}

export interface FamiliaBuscada {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string;
  es_prueba: boolean | null;
  atletas: Array<{ id: string; nombre: string; apellidos: string }>;
}

async function llamar<T>(supabase: SupabaseClient, metodo: 'GET' | 'POST', cuerpo?: unknown, query = ''): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  const r = await fetch(`/api/admin/pagos${query}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const d = (await r.json().catch(() => ({}))) as T & { mensaje?: string; error?: string };
  if (!r.ok) throw new Error(d.mensaje ?? d.error ?? `Error ${r.status}`);
  return d;
}

export const obtenerResumenPagos = (s: SupabaseClient, programa: ProgramaPagos) =>
  llamar<ResumenPagos>(s, 'GET', undefined, `?programa=${programa}`);

export const buscarFamilias = (s: SupabaseClient, texto: string) =>
  llamar<{ resultados: FamiliaBuscada[] }>(s, 'GET', undefined, `?buscar=${encodeURIComponent(texto)}`);

export const crearCargoManual = (
  s: SupabaseClient,
  datos: {
    apoderadoId: string;
    atletaId: string | null;
    programa: ProgramaPagos;
    concepto: string;
    descripcion: string;
    monto: number;
    vencimiento: string | null;
  },
) => llamar<{ ok: true }>(s, 'POST', { accion: 'cargo_manual', ...datos });

export const registrarKitStar = (s: SupabaseClient, ordenId: string) =>
  llamar<{ repetido: boolean; monto?: number }>(s, 'POST', { accion: 'registrar_kit', ordenId });

export const marcarFamiliaPrueba = (s: SupabaseClient, apoderadoId: string, valor: boolean) =>
  llamar<{ ok: true }>(s, 'POST', { accion: 'marcar_prueba', apoderadoId, valor });
