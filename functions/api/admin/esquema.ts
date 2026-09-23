// Cloudflare Pages Function — GET /api/admin/esquema
//
// Describe la estructura REAL de la base de datos para /admin/esquema, sin
// necesidad de entrar a Supabase. Solo para administradores activos.
//
// Fuentes, en orden:
//   1. fn_diagnostico_esquema() (migración 0006): catálogo completo — columnas,
//      restricciones, índices, políticas RLS, triggers y definición de funciones.
//   2. Especificación OpenAPI de PostgREST: tablas, columnas y funciones RPC.
//      Funciona sin haber ejecutado ninguna migración.
//
// Privacidad: nunca devuelve filas de datos. Solo estructura, conteos y
// agrupaciones de columnas de catálogo (ver AGRUPACIONES_PERMITIDAS).

import type { SupabaseClient } from '@supabase/supabase-js';
import { verificarAdmin, jsonResponse, type AdminEnv } from '../../lib/admin-auth.ts';
import {
  agrupar,
  agrupacionesAplicables,
  funcionesDesdeOpenApi,
  tablasDesdeCatalogo,
  tablasDesdeOpenApi,
  tablasFaltantes,
  type FuncionRpc,
  type TablaEsquema,
} from '../../../src/lib/crm/esquema.ts';

const PAGINA = 1000;
const MAX_FILAS_AGRUPACION = 20_000;

async function obtenerOpenApi(env: AdminEnv): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    accept: 'application/openapi+json',
  };
  // Las claves legacy son JWT y van también como Bearer; las nuevas (sb_secret_) no.
  if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) {
    headers.authorization = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  }
  try {
    const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, { headers });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function contarFilas(supabase: SupabaseClient, tabla: string): Promise<number | null> {
  const { count, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true });
  return error ? null : count ?? null;
}

async function leerColumnas(
  supabase: SupabaseClient,
  tabla: string,
  columnas: string[],
): Promise<Array<Record<string, unknown>> | null> {
  const filas: Array<Record<string, unknown>> = [];
  for (let desde = 0; desde < MAX_FILAS_AGRUPACION; desde += PAGINA) {
    const { data, error } = await supabase.from(tabla).select(columnas.join(',')).range(desde, desde + PAGINA - 1);
    if (error) return null;
    filas.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
    if (!data || data.length < PAGINA) break;
  }
  return filas;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await verificarAdmin(request, env);
  if (!admin.ok) return jsonResponse(admin.status, { error: admin.error });
  const { supabase } = admin;

  const advertencias: string[] = [];

  // 1. Catálogo completo (si la migración 0006 está aplicada).
  let avanzado: Record<string, unknown> | null = null;
  const diag = await supabase.rpc('fn_diagnostico_esquema');
  if (diag.error) {
    advertencias.push(
      'Detalle avanzado no disponible: falta ejecutar la migración 0006 (restricciones, políticas RLS, triggers y funciones).',
    );
  } else {
    avanzado = diag.data as Record<string, unknown>;
  }

  // 2. OpenAPI de PostgREST.
  const spec = await obtenerOpenApi(env);
  let tablas: TablaEsquema[] = [];
  let funciones: FuncionRpc[] = [];
  let fuenteTablas = 'ninguna';

  if (avanzado && Array.isArray(avanzado.tablas) && Array.isArray(avanzado.columnas)) {
    tablas = tablasDesdeCatalogo(avanzado.tablas as never, avanzado.columnas as never);
    fuenteTablas = 'catalogo';
    // Enriquecer PK/FK desde OpenAPI cuando esté disponible.
    if (spec) {
      const porOpenApi = new Map(tablasDesdeOpenApi(spec as never).map((t) => [t.nombre, t]));
      for (const t of tablas) {
        const o = porOpenApi.get(t.nombre);
        if (!o) continue;
        for (const c of t.columnas) {
          const oc = o.columnas.find((x) => x.nombre === c.nombre);
          if (oc) {
            c.pk = oc.pk;
            c.fk = oc.fk;
          }
        }
      }
    }
  } else if (spec) {
    tablas = tablasDesdeOpenApi(spec as never);
    fuenteTablas = 'openapi';
  } else {
    advertencias.push('No fue posible leer la estructura: ni la migración 0006 ni la especificación OpenAPI están disponibles.');
  }

  if (spec) funciones = funcionesDesdeOpenApi(spec as never);
  else if (!avanzado) advertencias.push('No se pudo obtener la lista de funciones RPC.');

  // 3. Conteos (en paralelo, sin datos).
  await Promise.all(
    tablas.map(async (t) => {
      t.filas = await contarFilas(supabase, t.nombre);
    }),
  );

  // 4. Agrupaciones de columnas de catálogo.
  const resumenes: Array<{ tabla: string; columnas: string[]; grupos: ReturnType<typeof agrupar> }> = [];
  for (const { tabla, columnas } of agrupacionesAplicables(tablas)) {
    const filas = await leerColumnas(supabase, tabla, columnas);
    if (filas) resumenes.push({ tabla, columnas, grupos: agrupar(filas, columnas) });
  }

  // 5. Migraciones registradas.
  let migraciones: unknown[] | null = null;
  const mig = await supabase.from('schema_migraciones').select('version, descripcion, aplicada_at, retroactiva').order('version');
  if (!mig.error) migraciones = mig.data ?? [];

  const faltantes = tablas.length ? tablasFaltantes(tablas) : [];
  if (faltantes.length) advertencias.push(`Tablas que el código usa y no aparecen: ${faltantes.join(', ')}.`);

  return jsonResponse(200, {
    generado_at: new Date().toISOString(),
    fuente_tablas: fuenteTablas,
    openapi_disponible: spec !== null,
    advertencias,
    migraciones,
    tablas,
    funciones_rpc: funciones,
    resumenes,
    avanzado: avanzado
      ? {
          restricciones: avanzado.restricciones ?? [],
          indices: avanzado.indices ?? [],
          politicas: avanzado.politicas ?? [],
          rls: avanzado.rls ?? [],
          triggers: avanzado.triggers ?? [],
          funciones: avanzado.funciones ?? [],
          vistas: avanzado.vistas ?? [],
          version_postgres: avanzado.version_postgres ?? null,
        }
      : null,
  });
};
