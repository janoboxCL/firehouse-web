import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faltantesFicha, validarFicha } from './ficha.ts';

const HOY = '2026-10-03';
const IDS = ['a1', 'a2'];
const base = {
  apoderado: { nombre: ' carolina ', apellidos: 'Rojas Díaz', telefono: '9 8765 4321', email: ' Caro@Correo.cl ', comuna: 'La Cisterna', relacion: 'MAMA' },
  atletas: [
    { id: 'a1', nombre: 'Sofía', apellidos: 'Pérez Rojas', fechaNacimiento: '2019-03-14', talla: '8' },
    { id: 'a2', nombre: 'Emma', apellidos: 'Pérez Rojas', fechaNacimiento: '2021-07-01', talla: '' },
  ],
  aceptaCondiciones: true,
};

test('ficha completa: limpia y normaliza', () => {
  const v = validarFicha(base, IDS, HOY);
  assert.ok(v.ok);
  assert.equal(v.datos.apoderado.nombre, 'carolina');
  assert.equal(v.datos.apoderado.telefono, '+56987654321');
  assert.equal(v.datos.apoderado.email, 'caro@correo.cl');
  assert.equal(v.datos.atletas.length, 2);
});

test('lo que deja un registro express no pasa sin completar', () => {
  const v = validarFicha(
    { apoderado: { nombre: 'Carolina', apellidos: '', telefono: '+56987654321', email: '', comuna: '', relacion: 'MAMA' },
      atletas: [{ id: 'a1', nombre: 'Sofía', apellidos: '', fechaNacimiento: '', talla: '8' }, base.atletas[1]], aceptaCondiciones: false },
    IDS, HOY);
  assert.ok(!v.ok);
  assert.deepEqual(Object.keys(v.errores).sort(), ['apoderado-apellidos', 'apoderado-comuna', 'apoderado-email', 'atleta-a1-apellidos', 'atleta-a1-fecha', 'condiciones']);
});

test('fechas: ni futuras ni inexistentes', () => {
  const con = (f: string) => validarFicha({ ...base, atletas: [{ ...base.atletas[0], fechaNacimiento: f }, base.atletas[1]] }, IDS, HOY);
  assert.ok(!con('2026-10-04').ok);
  assert.ok(!con('2019-02-30').ok);
  assert.ok(!con('14-03-2019').ok);
  assert.ok(con('2026-10-03').ok);
});

test('solo los deportistas de la familia, todos y sin repetir', () => {
  assert.ok(!validarFicha({ ...base, atletas: [base.atletas[0]] }, IDS, HOY).ok);
  assert.ok(!validarFicha({ ...base, atletas: [base.atletas[0], { ...base.atletas[1], id: 'ajeno' }] }, IDS, HOY).ok);
  assert.ok(!validarFicha({ ...base, atletas: [base.atletas[0], base.atletas[0]] }, IDS, HOY).ok);
  assert.ok(!validarFicha(null, IDS, HOY).ok);
});

test('teléfono, relación y apellido «—» de las visitas antiguas', () => {
  const con = (ap: object) => validarFicha({ ...base, apoderado: { ...base.apoderado, ...ap } }, IDS, HOY);
  assert.ok(!con({ telefono: '2 2345 6789' }).ok);
  assert.ok(!con({ relacion: 'ABUELA' }).ok);
  assert.ok(!con({ apellidos: '—' }).ok);
});

test('resumen de lo que falta', () => {
  assert.deepEqual(
    faltantesFicha({ confirmada: false, apoderado: { nombre: 'Carolina', apellidos: '', telefono: '+56987654321', email: '', comuna: '', relacion: 'MAMA' },
      atletas: [{ id: 'a1', nombre: 'Sofía', apellidos: '', fechaNacimiento: '', edadDeclarada: 7, talla: '8' }] }),
    ['apellidos', 'correo', 'comuna', 'fecha de nacimiento']);
});
