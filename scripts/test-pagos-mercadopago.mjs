#!/usr/bin/env node
// Prueba end-to-end de los dos flujos de pago (campaña 2026 y Firehouse
// Star) contra Mercado Pago EN MODO PRUEBA. Corre esto TÚ (local o en
// GitHub Actions) — Claude no tiene salida de red hacia Mercado Pago, tu
// Supabase, ni tu sitio, así que no puede ejecutar esto por ti.
//
// Qué hace, sin necesitar un navegador:
//   1. Llama a tu endpoint real de crear-orden (campaña o Star).
//   2. Le pregunta a Mercado Pago los datos de esa preferencia para
//      obtener su external_reference (= tu commerce_order).
//   3. Tokeniza una tarjeta de prueba y crea un pago DIRECTO contra la
//      API de pagos de Mercado Pago, usando ese mismo external_reference.
//      El nombre del titular ("APRO") le dice a Mercado Pago que apruebe
//      el pago automáticamente — así no hace falta pasar por la página
//      de checkout ni por un banco simulado.
//   4. Como el pago es real (de prueba, pero real dentro del sandbox),
//      Mercado Pago dispara tu webhook de verdad, con la firma real —
//      no se la puede fabricar, y no debería poderse: eso es lo que hace
//      que la verificación de firma de tu webhook sirva para algo.
//   5. Espera unos segundos y consulta tu Supabase directo para confirmar
//      que la orden y el pago quedaron marcados como pagados/aprobados.
//
// Variables de entorno requeridas (nunca las escribas en este archivo):
//   BASE_URL                     Ej: https://firehousecheer.cl
//                                 (con MERCADOPAGO_ACCESS_TOKEN = TEST-...
//                                  configurado en Cloudflare Pages en ese
//                                  momento — ver notas de la entrega)
//   MERCADOPAGO_ACCESS_TOKEN     El access token TEST- (el mismo que
//                                 pusiste en Cloudflare)
//   MERCADOPAGO_PUBLIC_KEY       La public key TEST- (para tokenizar la
//                                 tarjeta de prueba)
//   SUPABASE_URL                 Tu URL de Supabase
//   SUPABASE_SERVICE_ROLE_KEY    La service role key (para leer las
//                                 tablas directo y confirmar el resultado)
//
// Uso:
//   BASE_URL=https://firehousecheer.cl \
//   MERCADOPAGO_ACCESS_TOKEN=TEST-xxxx \
//   MERCADOPAGO_PUBLIC_KEY=TEST-xxxx \
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=xxxx \
//   node scripts/test-pagos-mercadopago.mjs
//
// Sale con código 0 si ambos flujos terminan aprobados, o con código 1 si
// alguno falla — pensado para poder usarse en CI sin que nadie mire la
// pantalla.

const MP_API = 'https://api.mercadopago.com';

function requireEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}. Revisa el encabezado de este script.`);
    process.exit(1);
  }
  return valor;
}

const BASE_URL = requireEnv('BASE_URL').replace(/\/$/, '');
const MP_ACCESS_TOKEN = requireEnv('MERCADOPAGO_ACCESS_TOKEN');
const MP_PUBLIC_KEY = requireEnv('MERCADOPAGO_PUBLIC_KEY');
const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!MP_ACCESS_TOKEN.startsWith('TEST-') || !MP_PUBLIC_KEY.startsWith('TEST-')) {
  console.error('Estas credenciales no empiezan con "TEST-" — para no arriesgarte a cobrar plata real, este script se niega a correr con credenciales que no sean explícitamente de prueba.');
  process.exit(1);
}

// Tarjeta de prueba oficial de Mercado Pago Chile (Mastercard). El nombre
// del titular es lo que decide el resultado, no el número de la tarjeta:
// APRO = aprobado, OTHE = error general, FUND = fondos insuficientes, etc.
const TARJETA_PRUEBA = { numero: '5416753003791008', mes: 11, anio: 2030, cvv: '123' };

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tokenizarTarjeta(nombreTitular) {
  const res = await fetch(`${MP_API}/v1/card_tokens?public_key=${encodeURIComponent(MP_PUBLIC_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      card_number: TARJETA_PRUEBA.numero,
      expiration_month: TARJETA_PRUEBA.mes,
      expiration_year: TARJETA_PRUEBA.anio,
      security_code: TARJETA_PRUEBA.cvv,
      cardholder: { name: nombreTitular, identification: { type: 'CI', number: '12345678' } },
    }),
  });
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(`No se pudo tokenizar la tarjeta: ${JSON.stringify(cuerpo).slice(0, 300)}`);
  return cuerpo.id;
}

async function obtenerExternalReference(urlPago) {
  const prefId = new URL(urlPago).searchParams.get('pref_id') ?? urlPago.split('/').pop();
  const res = await fetch(`${MP_API}/checkout/preferences/${encodeURIComponent(prefId)}`, {
    headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(`No se pudo leer la preferencia ${prefId}: ${JSON.stringify(cuerpo).slice(0, 300)}`);
  return { commerceOrder: cuerpo.external_reference, monto: Math.round(cuerpo.items[0].unit_price * cuerpo.items[0].quantity) };
}

async function crearPagoDirecto({ token, monto, externalReference, email }) {
  const res = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'x-idempotency-key': `test-${externalReference}`,
    },
    body: JSON.stringify({
      transaction_amount: monto,
      token,
      description: 'Prueba automatizada',
      installments: 1,
      payment_method_id: 'master',
      payer: { email },
      external_reference: externalReference,
    }),
  });
  const cuerpo = await res.json();
  if (!res.ok) throw new Error(`No se pudo crear el pago directo: ${JSON.stringify(cuerpo).slice(0, 400)}`);
  return cuerpo;
}

async function consultarSupabase(tabla, filtros, seleccion) {
  const params = new URLSearchParams({ select: seleccion, ...filtros });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${params.toString()}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`No se pudo consultar ${tabla}: HTTP ${res.status}`);
  return res.json();
}

async function esperarEstado({ tabla, commerceOrder, estadoEsperado, intentos = 6, esperaMs = 3000 }) {
  for (let i = 0; i < intentos; i++) {
    const filas = await consultarSupabase(tabla, { commerce_order: `eq.${commerceOrder}` }, 'estado');
    if (filas[0]?.estado === estadoEsperado) return true;
    await esperar(esperaMs);
  }
  return false;
}

async function pagarConTarjetaDePrueba({ urlPago, email, nombreTitular = 'APRO' }) {
  const { commerceOrder, monto } = await obtenerExternalReference(urlPago);
  const token = await tokenizarTarjeta(nombreTitular);
  const pago = await crearPagoDirecto({ token, monto, externalReference: commerceOrder, email });
  return { commerceOrder, monto, pago };
}

async function probarFlujoStar() {
  console.log('\n=== Firehouse Star ===');
  const email = `test-star-${Date.now()}@testuser.com`;

  const resOrden = await fetch(`${BASE_URL}/api/registro-star/crear-orden`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apoderado: { nombre: 'Prueba', apellidos: 'Automatizada', telefono: '+56911111111', email, comuna: 'La Cisterna' },
      atletas: [{ nombre: 'Deportista', apellidos: 'De Prueba', fechaNacimiento: '2019-01-01' }],
      aceptaCondiciones: true,
    }),
  });
  const datosOrden = await resOrden.json();
  if (!resOrden.ok || !datosOrden.url) throw new Error(`crear-orden Star falló: ${JSON.stringify(datosOrden)}`);
  console.log('Orden creada:', datosOrden.ordenId);

  const { commerceOrder, pago } = await pagarConTarjetaDePrueba({ urlPago: datosOrden.url, email });
  console.log('Pago de prueba creado:', pago.id, '→', pago.status);

  const ok = await esperarEstado({ tabla: 'star_ordenes', commerceOrder, estadoEsperado: 'PAGADA' });
  console.log(ok ? '✅ star_ordenes quedó en PAGADA' : '❌ star_ordenes NO llegó a PAGADA a tiempo');
  return ok;
}

async function probarFlujoCampana() {
  console.log('\n=== Campaña 2026 ===');
  const email = `test-campana-${Date.now()}@testuser.com`;

  const resOrden = await fetch(`${BASE_URL}/api/campana-2026/crear-orden`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productos: ['BLAZE'], comprador: { nombre: 'Prueba Automatizada', email, telefono: '+56911111111' } }),
  });
  const datosOrden = await resOrden.json();
  if (!resOrden.ok || !datosOrden.url) throw new Error(`crear-orden campaña falló: ${JSON.stringify(datosOrden)}`);

  const { commerceOrder, pago } = await pagarConTarjetaDePrueba({ urlPago: datosOrden.url, email });
  console.log('Pago de prueba creado:', pago.id, '→', pago.status);

  const ok = await esperarEstado({ tabla: 'campana_ordenes', commerceOrder, estadoEsperado: 'PAGADA' });
  console.log(ok ? '✅ campana_ordenes quedó en PAGADA' : '❌ campana_ordenes NO llegó a PAGADA a tiempo');
  return ok;
}

async function main() {
  console.log(`Probando contra ${BASE_URL} con credenciales de prueba de Mercado Pago.\n`);
  let okStar = false;
  let okCampana = false;

  try {
    okStar = await probarFlujoStar();
  } catch (e) {
    console.error('❌ Firehouse Star — error:', e.message);
  }

  try {
    okCampana = await probarFlujoCampana();
  } catch (e) {
    console.error('❌ Campaña 2026 — error:', e.message);
  }

  console.log('\n=== Resumen ===');
  console.log('Firehouse Star:', okStar ? 'OK' : 'FALLÓ');
  console.log('Campaña 2026:  ', okCampana ? 'OK' : 'FALLÓ');

  process.exit(okStar && okCampana ? 0 : 1);
}

main();
