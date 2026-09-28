import test from 'node:test';
import assert from 'node:assert/strict';
import { correosCompartidos, estadoCandidato, lineasResumen, type Candidato } from './envio-grupal.ts';
import { opcionesDeFecha, validarNuevaFecha, type ReglasFecha } from './clase-fecha.ts';

const base: Candidato = {
  casoId: 'c1', nombreAtleta: 'Sofía', nombreApoderado: 'Carla', email: 'carla@x.cl', yaEnviado: null, bloqueo: null, faltantes: null,
};

test('selecciona por defecto solo a quien corresponde enviar', () => {
  assert.deepEqual(estadoCandidato(base), { enviable: true, seleccionado: true, nota: null });
  assert.equal(estadoCandidato({ ...base, email: null }).enviable, false);
  assert.equal(estadoCandidato({ ...base, email: 'sin-arroba' }).enviable, false);
  assert.equal(estadoCandidato({ ...base, bloqueo: 'Ya pagó la inscripción' }).nota, 'Ya pagó la inscripción');
  assert.equal(estadoCandidato({ ...base, faltantes: 'Falta la talla' }).enviable, false);
  const repetido = estadoCandidato({ ...base, yaEnviado: '2026-09-29T12:00:00Z' });
  assert.equal(repetido.enviable, true, 'se puede reenviar a mano');
  assert.equal(repetido.seleccionado, false, 'pero no por defecto');
});

test('avisa cuando dos hermanas comparten el correo', () => {
  const notas = correosCompartidos([base, { ...base, casoId: 'c2', nombreAtleta: 'Emilia', email: 'CARLA@x.cl ' }, { ...base, casoId: 'c3', email: 'otra@x.cl' }]);
  assert.equal(notas.size, 1);
  assert.match(notas.get('c2')!, /Mismo correo que Sofía/);
});

test('arma el resumen de la copia interna', () => {
  const l = lineasResumen(
    [
      { nombreAtleta: 'Sofía', nombreApoderado: 'Carla', email: 'c@x.cl', ok: true },
      { nombreAtleta: 'Emilia', nombreApoderado: 'Daniela', email: 'd@x.cl', ok: false, error: 'rechazado' },
    ],
    [{ nombreAtleta: 'Julieta', motivo: 'Sin correo registrado' }],
  );
  assert.equal(l[0], 'Enviado a 1 familia:');
  assert.ok(l.includes('✗ Emilia · Daniela: rechazado'));
  assert.ok(l.includes('– Julieta: Sin correo registrado'));
});

const reglas: ReglasFecha = { esStar: true, hoy: '2026-09-28', primeraClaseStar: '2026-10-03', diasHabilitados: { VIERNES: true, SABADO: true } };

test('valida la nueva fecha de la primera clase Star', () => {
  assert.deepEqual(validarNuevaFecha('2026-10-10', reglas), { ok: true, dia: 'SABADO' });
  assert.equal(validarNuevaFecha('2026-10-09', reglas).ok, false, 'viernes no es clase Star');
  assert.equal(validarNuevaFecha('2026-09-26', reglas).ok, false, 'antes de la primera clase y pasada');
  assert.equal(validarNuevaFecha('x', reglas).ok, false);
});

test('valida la nueva fecha de una clase de prueba general', () => {
  const r = { ...reglas, esStar: false };
  assert.deepEqual(validarNuevaFecha('2026-10-02', r), { ok: true, dia: 'VIERNES' });
  assert.deepEqual(validarNuevaFecha('2026-10-03', r), { ok: true, dia: 'SABADO' });
  assert.equal(validarNuevaFecha('2026-10-01', r).ok, false, 'jueves');
  assert.equal(validarNuevaFecha('2026-10-02', { ...r, diasHabilitados: { VIERNES: false, SABADO: true } }).ok, false);
});

test('ofrece los próximos sábados Star y conserva la fecha actual', () => {
  assert.deepEqual(opcionesDeFecha(reglas, '2026-10-03', 3), ['2026-10-03', '2026-10-10', '2026-10-17']);
  assert.deepEqual(opcionesDeFecha({ ...reglas, esStar: false }, null, 3), ['2026-10-02', '2026-10-03', '2026-10-09']);
});
