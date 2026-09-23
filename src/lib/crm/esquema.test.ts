import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agrupar,
  agrupacionesAplicables,
  extraerFk,
  funcionesDesdeOpenApi,
  tablasDesdeCatalogo,
  tablasDesdeOpenApi,
  tablasFaltantes,
} from './esquema.ts';

const SPEC = {
  definitions: {
    casos_crm: {
      required: ['id', 'journey'],
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Note:\nThis is a Primary Key.<pk/>' },
        atleta_id: { type: 'string', format: 'uuid', description: "Note:\nThis is a Foreign Key to `atletas.id`.<fk table='atletas' column='id'/>" },
        journey: { type: 'string', format: 'character varying' },
        estado: { type: 'string', format: 'character varying' },
      },
    },
    atletas: { properties: { id: { type: 'string', format: 'uuid', description: '<pk/>' } } },
  },
  paths: {
    '/': {},
    '/casos_crm': {},
    '/rpc/fn_confirmar_pago_star': {
      post: { parameters: [{ name: 'args', schema: { properties: { p_commerce_order: {}, p_monto: {} } } }] },
    },
  },
};

test('extrae la FK desde la descripción de PostgREST', () => {
  assert.equal(extraerFk("x <fk table='atletas' column='id'/>"), 'atletas.id');
  assert.equal(extraerFk('sin fk'), null);
  assert.equal(extraerFk(undefined), null);
});

test('convierte definiciones OpenAPI en tablas ordenadas con PK, FK y requeridas', () => {
  const tablas = tablasDesdeOpenApi(SPEC);
  assert.deepEqual(tablas.map((t) => t.nombre), ['atletas', 'casos_crm']);
  const casos = tablas[1];
  assert.equal(casos.columnas.find((c) => c.nombre === 'id')?.pk, true);
  assert.equal(casos.columnas.find((c) => c.nombre === 'atleta_id')?.fk, 'atletas.id');
  assert.equal(casos.columnas.find((c) => c.nombre === 'journey')?.requerida, true);
  assert.equal(casos.columnas.find((c) => c.nombre === 'estado')?.requerida, false);
});

test('lista funciones RPC con sus parámetros', () => {
  assert.deepEqual(funcionesDesdeOpenApi(SPEC), [
    { nombre: 'fn_confirmar_pago_star', parametros: ['p_commerce_order', 'p_monto'] },
  ]);
});

test('construye tablas desde el catálogo e ignora vistas', () => {
  const tablas = tablasDesdeCatalogo(
    [{ tabla: 'casos_crm', tipo: 'BASE TABLE' }, { tabla: 'v_algo', tipo: 'VIEW' }],
    [
      { tabla: 'casos_crm', columna: 'id', tipo: 'uuid', nulable: false, por_defecto: 'gen_random_uuid()' },
      { tabla: 'casos_crm', columna: 'journey', tipo: 'character varying', nulable: false, por_defecto: null },
    ],
  );
  assert.equal(tablas.length, 1);
  assert.equal(tablas[0].columnas.find((c) => c.nombre === 'id')?.requerida, false);
  assert.equal(tablas[0].columnas.find((c) => c.nombre === 'journey')?.requerida, true);
});

test('agrupa combinaciones y trata nulos como (vacío)', () => {
  const r = agrupar(
    [
      { journey: 'A', estado: 'NUEVO' },
      { journey: 'A', estado: 'NUEVO' },
      { journey: 'B', estado: null },
    ],
    ['journey', 'estado'],
  );
  assert.deepEqual(r, [
    { valores: { journey: 'A', estado: 'NUEVO' }, total: 2 },
    { valores: { journey: 'B', estado: '(vacío)' }, total: 1 },
  ]);
});

test('solo aplica agrupaciones cuyas columnas existen', () => {
  const tablas = tablasDesdeOpenApi(SPEC);
  assert.deepEqual(agrupacionesAplicables(tablas), [{ tabla: 'casos_crm', columnas: ['journey', 'estado'] }]);
});

test('informa las tablas esperadas que no aparecen', () => {
  const faltan = tablasFaltantes(tablasDesdeOpenApi(SPEC));
  assert.ok(faltan.includes('star_ordenes'));
  assert.ok(!faltan.includes('casos_crm'));
});
