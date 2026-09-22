import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const migration = readFileSync(new URL('../supabase/migrations/0005_campana_2026_mecanica_unificada.sql', import.meta.url), 'utf8');
const allocate = (active, requested) => Math.min(requested, Math.max(0, 3-active));
for (const [name, active, requested, expected] of [
 ['nuevo RUT + Blaze',0,1,1],['nuevo RUT + Pack',0,2,2],['participante con 2 + Pack',2,2,1],
 ['participante con 3 + Blaze',3,1,0],['gratis nuevo',0,3,3],['gratis con 1',1,3,2],['gratis con 2',2,3,1],['gratis con 3',3,3,0],
]) test(name,()=>assert.equal(allocate(active,requested),expected));

test('asignador bloquea participante y limita a tres',()=>{
 assert.match(migration,/for update/); assert.match(migration,/greatest\(0, 3-v_activas\)/); assert.match(migration,/least\(p_solicitadas/);
});
test('dos solicitudes concurrentes serializan por la misma fila',()=>assert.match(migration,/where id=p_participant_id for update/));
test('mismo RUT con correo distinto conserva participante',()=>assert.match(migration,/unique \(campaign_id, identity_hash\)/));
test('pending y rejected no llaman asignador',()=>assert.equal((migration.match(/fn_asignar_participaciones_campana\(v_order/g)||[]).length,1));
test('webhook repetido devuelve entradas existentes',()=>assert.match(migration,/if v_pago.estado='APROBADO'/));
test('payment ID es único',()=>assert.match(migration,/campana_pagos_payment_id_uniq/));
test('monto adulterado se rechaza',()=>assert.match(migration,/monto_o_moneda_no_coincide/));
test('DV inválido se valida server-side',()=>assert.match(readFileSync(new URL('../functions/api/campana-2026/participar-gratis.ts',import.meta.url),'utf8'),/rutValido/));
test('refund invalida sólo compra',()=>assert.match(migration,/source='COMPRA' and status='ACTIVE'/));
test('códigos no se reciclan',()=>assert.match(migration,/nextval\('campana_entry_no_seq'\)/));
test('outbox compra único',()=>assert.match(migration,/campana_outbox_compra_uniq/));
test('fallo de email queda FAILED',()=>assert.match(readFileSync(new URL('../functions/api/mercadopago/webhook.ts',import.meta.url),'utf8'),/status: 'FAILED'/));
test('correo usa exactamente códigos asignados',()=>assert.match(readFileSync(new URL('../functions/lib/resend.ts',import.meta.url),'utf8'),/datos\.codigos\.map/));
test('snapshot incluye sólo ACTIVE',()=>assert.match(migration,/campana_entradas where status='ACTIVE'/));
test('draw_index es consecutivo',()=>assert.match(migration,/row_number\(\) over\(order by entry_no,id\)/));
test('hash de snapshot es reproducible',()=>{const csv='draw_index,public_code\n1,FH26-000001';assert.equal(createHash('sha256').update(csv).digest('hex'),createHash('sha256').update(csv).digest('hex'));assert.match(migration,/digest\(v_csv,'sha256'\)/)});
test('snapshot cerrado es inmutable',()=>assert.match(migration,/snapshot_inmutable/));
test('máximo un premio está en Bases',()=>assert.match(readFileSync(new URL('../src/pages/campana-2026/bases.astro',import.meta.url),'utf8'),/máximo un premio/));
test('producto se libera antes de asignar',()=>assert.ok(migration.indexOf("estado='AVAILABLE'") < migration.indexOf("v_result:=fn_asignar")));
test('gratis y compra usan el mismo asignador',()=>assert.equal((migration.match(/fn_asignar_participaciones_campana\(p_participant_id|'COMPRA',v_solicitadas/g)||[]).length,2));
test('outbox no duplica participación gratuita',()=>assert.match(migration,/campana_outbox_gratis_uniq/));
test('snapshot no contiene PII',()=>assert.match(migration,/draw_index,public_code/));
