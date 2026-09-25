import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarFormato, MAX_HTML_CORREO, renderizarCorreo } from './correo-plantilla.ts';

// Mismo texto que la plantilla "2 · Inscripción y polera" de la migración 0012.
const INSCRIPCION = `Hola, {nombre_apoderado}:

¿Quieres que {nombre_atleta} llegue a su primera clase de Firehouse Star con su polera de entrenamiento y su scrunchie? Puedes hacer la inscripción desde ahora.

La inscripción ({valor_inscripcion}) incluye el Kit de Iniciación Firehouse Star:
- Polera de entrenamiento Firehouse Star
- Scrunchie Firehouse

[[boton: Inscribir a {nombre_atleta} | {link_pago}]]

Si prefieres esperar a que pruebe la clase, no hay ningún problema: también puedes hacer la inscripción después. Si aún no nos cuentas su talla de polera, respóndenos este correo con ella.

[[clase]]

Un abrazo,
{remitente}
{cargo} de Firehouse Star`;

const DATOS = {
  nombre_apoderado: 'Carla',
  nombre_atleta: 'Sofía',
  remitente: 'Benjamín',
  cargo: 'Head Coach',
  fecha_clase: 'el sábado 3 de octubre',
  hora_clase: '18:30',
  valor_inscripcion: '$10.000',
  link_pago: 'https://firehousecheer.cl/pago/abc123',
};

test('interpreta párrafos, listas, botones y la tarjeta de clase', () => {
  const bloques = interpretarFormato(INSCRIPCION);
  assert.deepEqual(
    bloques.map((b) => b.tipo),
    ['parrafo', 'parrafo', 'parrafo', 'lista', 'boton', 'parrafo', 'clase', 'parrafo'],
  );
  const lista = bloques[3];
  assert.equal(lista.tipo === 'lista' && lista.items.length, 2);
  const boton = bloques[4];
  assert.equal(boton.tipo === 'boton' && boton.url, '{link_pago}');
});

test('arma el correo completo sin faltantes y bajo el límite de tamaño', () => {
  const r = renderizarCorreo({
    asunto: 'Que {nombre_atleta} llegue a su primera clase con su polera ⭐',
    cuerpo: INSCRIPCION,
    datos: DATOS,
    clase: { etiqueta: 'Tu primera clase', horaFin: '20:00' },
  });
  assert.deepEqual(r.faltantes, []);
  assert.equal(r.asunto, 'Que Sofía llegue a su primera clase con su polera ⭐');
  assert.match(r.html, /href="https:\/\/firehousecheer\.cl\/pago\/abc123"/);
  assert.match(r.html, /Inscribir a Sofía/);
  assert.match(r.html, /Sábado 3 de octubre/);
  assert.match(r.html, /18:30 a 20:00 h/);
  assert.match(r.html, /media\/correo\/star-logo\.png/);
  assert.ok(r.html.length < MAX_HTML_CORREO, `HTML de ${r.html.length} caracteres`);
  assert.match(r.texto, /Inscribir a Sofía: https:\/\/firehousecheer\.cl\/pago\/abc123/);
  assert.match(r.texto, /- Scrunchie Firehouse/);
});

test('informa faltantes y deja un botón inofensivo en la vista previa', () => {
  const r = renderizarCorreo({
    asunto: '{nombre_atleta}',
    cuerpo: INSCRIPCION,
    datos: { ...DATOS, link_pago: null, fecha_clase: null },
    clase: { etiqueta: 'Tu primera clase' },
  });
  assert.ok(r.faltantes.includes('link_pago'));
  assert.ok(r.faltantes.includes('fecha_clase'));
  assert.match(r.html, /href="#"/);
});

test('los datos de una familia se escapan y no pueden crear botones', () => {
  const r = renderizarCorreo({
    asunto: 'Hola',
    cuerpo: 'Hola, {nombre_apoderado}:\n\nTexto',
    datos: { nombre_apoderado: '<b>[[boton: X | https://malo.cl]]</b>' },
  });
  assert.doesNotMatch(r.html, /<b>/);
  assert.doesNotMatch(r.html, /href="https:\/\/malo\.cl"/);
  assert.match(r.html, /&lt;b&gt;/);
});

test('un botón con link no https queda como texto', () => {
  const r = renderizarCorreo({ asunto: 'A', cuerpo: '[[boton: Pagar | javascript:alert(1)]]', datos: {} });
  assert.doesNotMatch(r.html, /href="javascript/);
  assert.match(r.html, /Pagar: javascript:alert\(1\)/);
});

test('sin datos de clase la tarjeta se omite (plantillas generales)', () => {
  const r = renderizarCorreo({ asunto: 'A', cuerpo: 'Hola\n\n[[clase]]\n\nChao', datos: {} });
  assert.deepEqual(r.faltantes, []);
  assert.doesNotMatch(r.html, /Ver en el mapa/);
});

test('convierte en link las URL https escritas en el texto', () => {
  const r = renderizarCorreo({ asunto: 'A', cuerpo: 'Hola\n\nMira https://firehousecheer.cl/star.', datos: {} });
  assert.match(r.html, /<a href="https:\/\/firehousecheer\.cl\/star"/);
});
