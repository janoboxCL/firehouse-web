// Lógica pura del diagnóstico de esquema (/admin/esquema).
// Sin red ni Supabase: la Function functions/api/admin/esquema.ts obtiene los
// datos crudos y esta librería los transforma, para poder testearla con node --test.
//
// Regla de privacidad: el diagnóstico NUNCA incluye filas de datos. Solo
// estructura (tablas, columnas, funciones), conteos y agrupaciones de columnas
// de catálogo (journey, estado, pasarela...), para que el JSON pueda compartirse.

export interface ColumnaEsquema {
  nombre: string;
  tipo: string;
  requerida: boolean;
  pk: boolean;
  fk: string | null; // "tabla.columna"
}

export interface TablaEsquema {
  nombre: string;
  columnas: ColumnaEsquema[];
  filas: number | null;
}

export interface FuncionRpc {
  nombre: string;
  parametros: string[];
}

/** Columnas que se pueden agrupar sin exponer datos personales. */
export const AGRUPACIONES_PERMITIDAS: Record<string, string[][]> = {
  casos_crm: [['journey', 'estado'], ['programa']],
  atletas: [['firehouse_actual']],
  star_ordenes: [['estado']],
  star_pagos: [['estado', 'pasarela']],
  campana_ordenes: [['estado']],
  inscripciones: [['programa_codigo', 'estado']],
};

interface PropiedadOpenApi {
  type?: string;
  format?: string;
  description?: string;
}

interface DefinicionOpenApi {
  properties?: Record<string, PropiedadOpenApi>;
  required?: string[];
}

interface OpenApiSpec {
  definitions?: Record<string, DefinicionOpenApi>;
  paths?: Record<string, { post?: { parameters?: Array<{ name?: string; schema?: { properties?: Record<string, unknown> } }> } }>;
}

/** PostgREST marca PK y FK dentro de la descripción: <pk/> y <fk table='x' column='y'/>. */
export function extraerFk(descripcion: string | undefined): string | null {
  if (!descripcion) return null;
  const m = descripcion.match(/<fk table='([^']+)' column='([^']+)'\/>/);
  return m ? `${m[1]}.${m[2]}` : null;
}

export function tablasDesdeOpenApi(spec: OpenApiSpec): TablaEsquema[] {
  const defs = spec.definitions ?? {};
  return Object.keys(defs)
    .sort()
    .map((nombre) => {
      const def = defs[nombre];
      const requeridas = new Set(def.required ?? []);
      const columnas = Object.entries(def.properties ?? {}).map(([col, p]) => ({
        nombre: col,
        tipo: p.format || p.type || 'desconocido',
        requerida: requeridas.has(col),
        pk: (p.description ?? '').includes('<pk/>'),
        fk: extraerFk(p.description),
      }));
      return { nombre, columnas, filas: null };
    });
}

export function funcionesDesdeOpenApi(spec: OpenApiSpec): FuncionRpc[] {
  return Object.entries(spec.paths ?? {})
    .filter(([ruta]) => ruta.startsWith('/rpc/'))
    .map(([ruta, def]) => {
      const cuerpo = def.post?.parameters?.find((p) => p.schema?.properties);
      return {
        nombre: ruta.slice('/rpc/'.length),
        parametros: Object.keys(cuerpo?.schema?.properties ?? {}),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Estructura de fn_diagnostico_esquema() (migración 0006). */
export interface ColumnaCatalogo {
  tabla: string;
  columna: string;
  tipo: string;
  nulable: boolean;
  por_defecto: string | null;
}

export function tablasDesdeCatalogo(
  tablas: Array<{ tabla: string; tipo: string }>,
  columnas: ColumnaCatalogo[],
): TablaEsquema[] {
  return tablas
    .filter((t) => t.tipo === 'BASE TABLE')
    .map((t) => ({
      nombre: t.tabla,
      filas: null,
      columnas: columnas
        .filter((c) => c.tabla === t.tabla)
        .map((c) => ({ nombre: c.columna, tipo: c.tipo, requerida: !c.nulable && c.por_defecto === null, pk: false, fk: null })),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Cuenta combinaciones de valores. Devuelve filas ordenadas de mayor a menor. */
export function agrupar(
  filas: Array<Record<string, unknown>>,
  columnas: string[],
): Array<{ valores: Record<string, string>; total: number }> {
  const conteo = new Map<string, { valores: Record<string, string>; total: number }>();
  for (const fila of filas) {
    const valores: Record<string, string> = {};
    for (const c of columnas) {
      const v = fila[c];
      valores[c] = v === null || v === undefined ? '(vacío)' : String(v);
    }
    const clave = columnas.map((c) => valores[c]).join('\u0000');
    const actual = conteo.get(clave);
    if (actual) actual.total += 1;
    else conteo.set(clave, { valores, total: 1 });
  }
  return [...conteo.values()].sort((a, b) => b.total - a.total || JSON.stringify(a.valores).localeCompare(JSON.stringify(b.valores)));
}

/** Qué agrupaciones se pueden ejecutar según las columnas que realmente existen. */
export function agrupacionesAplicables(tablas: TablaEsquema[]): Array<{ tabla: string; columnas: string[] }> {
  const resultado: Array<{ tabla: string; columnas: string[] }> = [];
  for (const [tabla, grupos] of Object.entries(AGRUPACIONES_PERMITIDAS)) {
    const t = tablas.find((x) => x.nombre === tabla);
    if (!t) continue;
    const existentes = new Set(t.columnas.map((c) => c.nombre));
    for (const cols of grupos) {
      if (cols.every((c) => existentes.has(c))) resultado.push({ tabla, columnas: cols });
    }
  }
  return resultado;
}

/** Tablas que el código usa y que el diagnóstico debe confirmar que existen. */
export const TABLAS_ESPERADAS = [
  'apoderados', 'atletas', 'casos_crm', 'interacciones', 'admin_profiles', 'registro_submissions',
  'notas_apoderado', 'plantillas_mensaje', 'configuracion_clase_prueba',
  'star_ordenes', 'star_orden_atletas', 'star_pagos',
  'campana_config', 'campana_ordenes', 'campana_pagos', 'campana_pasarelas',
];

export function tablasFaltantes(tablas: TablaEsquema[]): string[] {
  const existentes = new Set(tablas.map((t) => t.nombre));
  return TABLAS_ESPERADAS.filter((t) => !existentes.has(t));
}
