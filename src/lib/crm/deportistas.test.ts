import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CasoResumen } from './admin-api.ts';
import {
  calcularEmbudo,
  calcularEstadisticas,
  construirFilas,
  construirSesiones,
  fechaCorta,
  filtrarFilas,
  ordenarFilas,
  porcentajeTexto,
  programaDe,
  topConOtras,
} from './deportistas.ts';

let n = 0;
function caso(o: {
  atleta: string;
  journey: string;
  estado?: string;
  fecha?: string | null;
  creado?: string;
  nac?: string;
  apoderado?: string;
  comuna?: string;
  programa?: string | null;
}): CasoResumen {
  n += 1;
  return {
    id: `c${n}`,
    journey: o.journey,
    estado: o.estado ?? 'NUEVO',
    como_conocio: 'INSTAGRAM',
    fecha_clase_prueba: o.fecha ?? null,
    created_at: o.creado ?? '2026-09-20T15:00:00Z',
    programa: o.programa ?? null,
    atleta: {
      id: o.atleta,
      nombre: o.atleta.toUpperCase(),
      apellidos: 'Pérez',
      fecha_nacimiento: o.nac ?? '2018-05-10',
      apoderado: { id: o.apoderado ?? `ap-${o.atleta}`, nombre: 'Ana', apellidos: 'Soto', telefono: '+56911112222', email: 'a@x.cl', comuna: o.comuna ?? 'La Cisterna' },
    },
  } as unknown as CasoResumen;
}

const OP = { hoy: '2026-10-18', primeraClaseStar: '2026-10-03' };
// Sesiones Star: 3, 10 y 17 de octubre.
const sofia = caso({ atleta: 'sofia', journey: 'FIREHOUSE_STAR', estado: 'INSCRITO', fecha: '2026-10-03', apoderado: 'fam1' });
const ema = caso({ atleta: 'ema', journey: 'FIREHOUSE_STAR', estado: 'NUEVO', fecha: '2026-10-03', apoderado: 'fam1', nac: '2020-01-01' });
const ines = caso({ atleta: 'ines', journey: 'FIREHOUSE_STAR', estado: 'INSCRITO', fecha: '2026-10-10', comuna: 'San Miguel' });
const pruebaPrevia = caso({ atleta: 'ines', journey: 'CLASE_PRUEBA_STAR', estado: 'ASISTIO', fecha: '2026-10-03', creado: '2026-09-25T15:00:00Z' });
const tomas = caso({ atleta: 'tomas', journey: 'CLASE_PRUEBA', estado: 'AGENDADO', fecha: '2026-10-10' });
const rosa = caso({ atleta: 'rosa', journey: 'CLASE_PRUEBA_STAR', estado: 'AGENDADO', fecha: '2026-10-24' });
const ida = caso({ atleta: 'ida', journey: 'FIREHOUSE_STAR', estado: 'NO_CONTINUA', fecha: '2026-10-03' });
const casos = [sofia, ema, ines, pruebaPrevia, tomas, rosa, ida];
const asistencias = [
  { atleta_id: 'sofia', fecha: '2026-10-03' },
  { atleta_id: 'sofia', fecha: '2026-10-10' },
  { atleta_id: 'sofia', fecha: '2026-10-17' },
  { atleta_id: 'ema', fecha: '2026-10-03' },
  { atleta_id: 'ines', fecha: '2026-10-03' },
  { atleta_id: 'ines', fecha: '2026-10-17' },
];

const filas = construirFilas(casos, asistencias, OP);
const fila = (id: string) => filas.find((f) => f.atletaId === id)!;

test('programaDe clasifica por journey y luego por programa', () => {
  assert.equal(programaDe({ journey: 'FIREHOUSE_STAR', programa: null }), 'STAR');
  assert.equal(programaDe({ journey: 'CLASE_PRUEBA_STAR', programa: 'STAR' }), 'PRUEBA');
  assert.equal(programaDe({ journey: 'RENOVACION_2027', programa: 'ALL_STAR' }), 'ALL_STAR');
  assert.equal(programaDe({ journey: 'POR_CLASIFICAR', programa: null }), 'OTRO');
});

test('una fila por deportista, con el caso Star como principal', () => {
  assert.equal(filas.length, 6);
  assert.equal(fila('ines').programa, 'STAR');
  assert.equal(fila('ines').casoId, ines.id);
});

test('asistencia Star: cuenta solo las sesiones desde su primera clase', () => {
  assert.deepEqual([fila('sofia').asistidas, fila('sofia').esperadas], [3, 3]);
  assert.deepEqual([fila('ines').asistidas, fila('ines').esperadas], [1, 2]); // 10 y 17; el 3 fue su clase de prueba
  assert.equal(fila('ines').ultimaClase, '2026-10-17');
  assert.equal(fila('sofia').kit, 'PAGADO');
  assert.equal(fila('ema').kit, 'PENDIENTE');
});

test('falta a dos sábados seguidos solo si está activa', () => {
  assert.equal(fila('ema').faltaSeguidas, true);
  assert.equal(fila('sofia').faltaSeguidas, false);
  assert.equal(fila('ida').faltaSeguidas, false);
});

test('clase de prueba: 0/1 si ya pasó sin asistencia; sin contar si es futura', () => {
  assert.deepEqual([fila('tomas').asistidas, fila('tomas').esperadas], [0, 1]);
  assert.deepEqual([fila('rosa').asistidas, fila('rosa').esperadas], [0, 0]);
});

test('edad al día de hoy e ingreso en fecha de Chile', () => {
  assert.equal(fila('sofia').edad, 8);
  assert.equal(fila('sofia').ingreso, '2026-09-20');
});

test('filtros: por defecto oculta retirados; extras y búsqueda', () => {
  assert.equal(filtrarFilas(filas, 'TODOS', 'NINGUNO', '').length, 5);
  assert.deepEqual(filtrarFilas(filas, 'TODOS', 'RETIRADOS', '').map((f) => f.atletaId), ['ida']);
  assert.deepEqual(filtrarFilas(filas, 'STAR', 'KIT_PENDIENTE', '').map((f) => f.atletaId), ['ema']);
  assert.deepEqual(filtrarFilas(filas, 'TODOS', 'FALTAN', '').map((f) => f.atletaId), ['ema']);
  assert.deepEqual(filtrarFilas(filas, 'PRUEBA', 'NINGUNO', '').map((f) => f.atletaId).sort(), ['rosa', 'tomas']);
  assert.deepEqual(filtrarFilas(filas, 'TODOS', 'NINGUNO', 'san miguel').map((f) => f.atletaId), ['ines']);
});

test('orden por menor asistencia deja sin sesiones al final', () => {
  const orden = ordenarFilas(filtrarFilas(filas, 'TODOS', 'NINGUNO', ''), 'ASISTENCIA').map((f) => f.atletaId);
  assert.deepEqual(orden.slice(0, 2), ['tomas', 'ema']);
  assert.equal(orden[orden.length - 1], 'rosa');
});

test('sesiones: presentes y ausentes esperados por fecha', () => {
  const ses = construirSesiones(filas, asistencias, '2026-10-03');
  assert.deepEqual(ses.map((s) => s.fecha), ['2026-10-17', '2026-10-10', '2026-10-03']);
  const s10 = ses.find((s) => s.fecha === '2026-10-10')!;
  assert.deepEqual(s10.presentes.map((f) => f.atletaId), ['sofia']);
  assert.deepEqual(s10.ausentes.map((f) => f.atletaId).sort(), ['ema', 'ines', 'tomas']);
  assert.equal(s10.esperados, 4);
});

test('estadísticas: familias con hermanos, edades, comunas y asistencia promedio', () => {
  const star = filtrarFilas(filas, 'STAR', 'NINGUNO', '');
  const e = calcularEstadisticas(star, construirSesiones(filas, asistencias, '2026-10-03'));
  assert.equal(e.deportistas, 3);
  assert.equal(e.familias, 2);
  assert.equal(e.familiasConHermanos, 1);
  assert.equal(e.deportistasConHermanos, 2);
  assert.deepEqual(e.edades.map((b) => `${b.etiqueta}:${b.n}`), ['6:1', '7:0', '8:2']);
  assert.deepEqual(e.comunas.map((b) => `${b.etiqueta}:${b.n}`), ['La Cisterna:2', 'San Miguel:1']);
  // 3 oct: sofia, ema (2/2) · 10 oct: sofia (1/3) · 17 oct: sofia, ines (2/3) → 5 de 8
  assert.equal(e.totalAsistencias, 5);
  assert.equal(e.asistenciaPromedio, 5 / 8);
  assert.equal(e.kitPendiente, 1);
});

test('embudo de clase de prueba a inscripción', () => {
  const e = calcularEmbudo(casos, asistencias, '2026-10-18');
  // Realizadas: ines (3 oct) y tomas (10 oct). Asistió: ines. Inscrita: ines.
  assert.deepEqual(e, { realizadas: 2, asistieron: 1, inscritas: 1 });
});

test('formatos chilenos', () => {
  assert.equal(porcentajeTexto(0.746), '74,6 %');
  assert.equal(porcentajeTexto(null), '—');
  assert.equal(fechaCorta('2026-10-03', '2026'), '3 oct');
  assert.equal(fechaCorta('2025-12-20', '2026'), '20 dic 2025');
  assert.deepEqual(
    topConOtras([{ etiqueta: 'a', n: 5 }, { etiqueta: 'b', n: 3 }, { etiqueta: 'c', n: 2 }, { etiqueta: 'd', n: 1 }], 3),
    [{ etiqueta: 'a', n: 5 }, { etiqueta: 'b', n: 3 }, { etiqueta: 'Otras (2)', n: 3 }],
  );
});
