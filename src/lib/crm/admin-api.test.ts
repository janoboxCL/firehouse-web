import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  casoEstaVencido,
  casoEsParaHoy,
  ordenarCasos,
  filtrarCasos,
  coincideBusqueda,
  casoSinProximaAccion,
  type CasoResumen,
} from './admin-api.ts';

const AHORA = new Date('2026-08-24T15:00:00-04:00'); // martes, horario Chile de verano/invierno aparte, sólo referencia

function caso(overrides: Partial<CasoResumen> & { id: string }): CasoResumen {
  return {
    journey: 'PRETEMPORADA',
    estado: 'NUEVO',
    intencion_inicial: null,
    como_conocio: 'INSTAGRAM',
    comentario_inicial: null,
    responsable_id: null,
    proxima_accion: 'Contactar apoderado',
    fecha_proxima_accion: null,
    prioridad: 'NORMAL',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    atleta: {
      id: 'a1',
      nombre: 'Martina',
      apellidos: 'Pérez',
      fecha_nacimiento: '2018-01-01',
      firehouse_actual: false,
      tiene_experiencia: false,
      anos_experiencia: null,
      academia_anterior: null,
      fuera_rango_habitual: false,
      apoderado: {
        id: 'ap1',
        nombre: 'Carolina',
        apellidos: 'Pérez',
        telefono: '+56912345678',
        telefono_secundario: null,
        email: 'carolina@example.com',
        comuna: 'La Cisterna',
        relacion: 'MAMA',
        canal_preferido: 'WHATSAPP',
        possible_duplicate: false,
        duplicate_reason: null,
      },
    },
    ...overrides,
  } as CasoResumen;
}

test('un caso INSCRITO nunca está vencido aunque su fecha ya pasó', () => {
  const c = caso({ id: '1', estado: 'INSCRITO', fecha_proxima_accion: '2020-01-01T00:00:00Z' });
  assert.equal(casoEstaVencido(c, AHORA), false);
});

test('un caso NUEVO con fecha_proxima_accion en el pasado está vencido', () => {
  const c = caso({ id: '1', fecha_proxima_accion: '2026-08-20T00:00:00Z' });
  assert.equal(casoEstaVencido(c, AHORA), true);
});

test('un caso con fecha_proxima_accion hoy es "para hoy" y no "vencido"', () => {
  const c = caso({ id: '1', fecha_proxima_accion: '2026-08-24T09:00:00-04:00' });
  assert.equal(casoEsParaHoy(c, AHORA), true);
  assert.equal(casoEstaVencido(c, AHORA), false);
});

test('orden: vencidos primero, luego hoy, luego nuevos, luego resto', () => {
  const vencido = caso({ id: 'vencido', estado: 'CONTACTADO', fecha_proxima_accion: '2026-08-10T00:00:00Z', created_at: '2026-08-01T00:00:00Z' });
  const hoy = caso({ id: 'hoy', estado: 'CONTACTADO', fecha_proxima_accion: '2026-08-24T10:00:00-04:00', created_at: '2026-08-02T00:00:00Z' });
  const nuevo = caso({ id: 'nuevo', estado: 'NUEVO', fecha_proxima_accion: null, created_at: '2026-08-23T00:00:00Z' });
  const resto = caso({ id: 'resto', estado: 'SEGUIMIENTO', fecha_proxima_accion: '2026-09-01T00:00:00Z', created_at: '2026-08-05T00:00:00Z' });

  const orden = ordenarCasos([resto, nuevo, hoy, vencido], AHORA).map((c) => c.id);
  assert.deepEqual(orden, ['vencido', 'hoy', 'nuevo', 'resto']);
});

test('filtrarCasos: por journey y estado combinados', () => {
  const a = caso({ id: 'a', journey: 'PRETEMPORADA', estado: 'NUEVO' });
  const b = caso({ id: 'b', journey: 'PRETEMPORADA', estado: 'CONTACTADO' });
  const c = caso({ id: 'c', journey: 'PRINCIPIANTE_2027', estado: 'NUEVO' });
  const r = filtrarCasos([a, b, c], { journey: 'PRETEMPORADA', estado: 'NUEVO' }, AHORA);
  assert.deepEqual(r.map((x) => x.id), ['a']);
});

test('filtrarCasos: fecha ATRASADOS usa la misma regla que casoEstaVencido', () => {
  const vencido = caso({ id: 'v', fecha_proxima_accion: '2026-08-01T00:00:00Z' });
  const futuro = caso({ id: 'f', fecha_proxima_accion: '2026-09-01T00:00:00Z' });
  const r = filtrarCasos([vencido, futuro], { fecha: 'ATRASADOS' }, AHORA);
  assert.deepEqual(r.map((x) => x.id), ['v']);
});

test('coincideBusqueda: encuentra por nombre de atleta, apoderado, teléfono o email', () => {
  const c = caso({ id: '1' });
  assert.equal(coincideBusqueda(c, 'martina'), true);
  assert.equal(coincideBusqueda(c, 'Carolina'), true);
  assert.equal(coincideBusqueda(c, '912345678'), true);
  assert.equal(coincideBusqueda(c, 'carolina@example.com'), true);
  assert.equal(coincideBusqueda(c, 'no-existe'), false);
});

test('casoSinProximaAccion: true si está abierto y sin próxima acción', () => {
  const c = caso({ id: '1', estado: 'CONTACTADO', proxima_accion: null });
  assert.equal(casoSinProximaAccion(c), true);
});

test('casoSinProximaAccion: false si está cerrado aunque no tenga próxima acción', () => {
  const c = caso({ id: '1', estado: 'INSCRITO', proxima_accion: null });
  assert.equal(casoSinProximaAccion(c), false);
});
