-- Pruebas de comportamiento de la migración 0005 (Campaña 2026).
-- Se ejecutan sobre una COPIA de la base (nunca en producción): crean datos de
-- prueba y los dejan ahí. Cada bloque falla con una excepción si algo no cumple.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create or replace function pg_temp.t_part(p_hash text, p_email text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into campana_participantes (campaign_id, identity_hash, rut_masked, nombre, email, bases_version, bases_accepted_at)
  values ('FIREHOUSE_2026', p_hash, '12.***.***-5', 'Prueba', p_email, '2026-1.0', now())
  on conflict (campaign_id, identity_hash) do nothing;
  select id into v from campana_participantes where campaign_id = 'FIREHOUSE_2026' and identity_hash = p_hash;
  return v;
end $$;

create or replace function pg_temp.t_orden(p_part uuid, p_prods text[], p_co text) returns uuid language plpgsql as $$
declare v uuid; v_monto integer; v_item uuid; p text;
begin
  select coalesce(sum(case x when 'BLAZE_NOVA' then 5000 else 3000 end), 0) into v_monto from unnest(p_prods) x;
  insert into campana_ordenes (commerce_order, participant_id, comprador_nombre, comprador_email, comprador_telefono, monto, bases_version, bases_accepted_at)
  values (p_co, p_part, 'Prueba', 'p@x.cl', '+56900000000', v_monto, '2026-1.0', now()) returning id into v;
  foreach p in array p_prods loop
    insert into campana_orden_items (orden_id, producto, precio) values (v, p, case p when 'BLAZE_NOVA' then 5000 else 3000 end) returning id into v_item;
    insert into campana_entregas (orden_item_id, estado) values (v_item, 'LOCKED');
  end loop;
  insert into campana_pagos (orden_id, pasarela, monto, moneda, estado) values (v, 'MERCADOPAGO', v_monto, 'CLP', 'PENDIENTE');
  return v;
end $$;

create or replace function pg_temp.t_pagar(p_co text, p_pay text) returns jsonb language sql as $$
  select fn_confirmar_pago_campana(p_co, 'MERCADOPAGO', p_pay,
    (select monto from campana_ordenes where commerce_order = p_co), 'CLP', 'credit_card', '{}'::jsonb)
$$;

create or replace function pg_temp.t_activas(p uuid) returns integer language sql as $$
  select count(*)::integer from campana_entradas where participant_id = p and status = 'ACTIVE'
$$;

-- COMPRA -----------------------------------------------------------------------
do $$ declare p uuid := pg_temp.t_part('h01','a@x.cl'); r jsonb; begin
  perform pg_temp.t_orden(p, array['BLAZE'], 'T01'); r := pg_temp.t_pagar('T01', 'pay01');
  assert (r->>'asignadas')::int = 1 and pg_temp.t_activas(p) = 1, 'T01 nuevo RUT + Blaze debe asignar 1';
  raise notice 'OK 01 nuevo RUT + Blaze -> 1 (%)', r->'codigos'; end $$;

do $$ declare p uuid := pg_temp.t_part('h02','b@x.cl'); r jsonb; begin
  perform pg_temp.t_orden(p, array['BLAZE_NOVA'], 'T02'); r := pg_temp.t_pagar('T02', 'pay02');
  assert (r->>'asignadas')::int = 2, 'T02 Pack debe asignar 2';
  raise notice 'OK 02 nuevo RUT + Pack -> 2'; end $$;

do $$ declare p1 uuid := pg_temp.t_part('h02','otro@correo.cl'); begin
  assert p1 = (select id from campana_participantes where identity_hash = 'h02'), 'T03 mismo RUT debe ser el mismo participante';
  assert (select email from campana_participantes where identity_hash = 'h02') = 'b@x.cl', 'T03 no debe sobrescribir el correo original';
  raise notice 'OK 03 mismo RUT con otro correo -> mismo participante'; end $$;

do $$ declare p uuid := pg_temp.t_part('h02','b@x.cl'); r jsonb; begin
  perform pg_temp.t_orden(p, array['BLAZE_NOVA'], 'T04'); r := pg_temp.t_pagar('T04', 'pay04');
  assert (r->>'solicitadas')::int = 2 and (r->>'asignadas')::int = 1 and (r->>'total')::int = 3, 'T04 con 2 + Pack debe asignar 1';
  raise notice 'OK 04 participante con 2 + Pack -> 1'; end $$;

do $$ declare p uuid := pg_temp.t_part('h02','b@x.cl'); r jsonb; v uuid; begin
  v := pg_temp.t_orden(p, array['BLAZE'], 'T05'); r := pg_temp.t_pagar('T05', 'pay05');
  assert (r->>'asignadas')::int = 0 and pg_temp.t_activas(p) = 3, 'T05 con 3 no debe asignar';
  assert (select estado from campana_ordenes where id = v) = 'PAGADA', 'T05 la compra debe quedar pagada';
  assert not exists (select 1 from campana_entregas e join campana_orden_items i on i.id = e.orden_item_id where i.orden_id = v and e.estado <> 'READY'), 'T05 el producto debe entregarse';
  raise notice 'OK 05 participante con 3 + Blaze -> 0, producto entregado'; end $$;

do $$ declare p uuid := pg_temp.t_part('h06','f@x.cl'); v uuid; begin
  v := pg_temp.t_orden(p, array['NOVA'], 'T06');
  perform fn_marcar_pago_no_aprobado_campana('T06', 'MERCADOPAGO', 'PENDIENTE', null);
  assert pg_temp.t_activas(p) = 0 and (select estado from campana_entregas e join campana_orden_items i on i.id = e.orden_item_id where i.orden_id = v) = 'LOCKED', 'T06 pendiente no asigna ni entrega';
  perform pg_temp.t_orden(p, array['NOVA'], 'T07');
  perform fn_marcar_pago_no_aprobado_campana('T07', 'MERCADOPAGO', 'RECHAZADO', 'RECHAZADA');
  assert pg_temp.t_activas(p) = 0, 'T07 rechazado no asigna';
  raise notice 'OK 06-07 pago pendiente o rechazado -> 0'; end $$;

do $$ declare r1 jsonb; r2 jsonb; n integer; begin
  select count(*) into n from campana_entradas where order_id = (select id from campana_ordenes where commerce_order = 'T01');
  r2 := pg_temp.t_pagar('T01', 'pay01');
  assert (r2->>'repetido')::boolean and (select count(*) from campana_entradas where order_id = (select id from campana_ordenes where commerce_order = 'T01')) = n, 'T08 webhook repetido no crea entradas';
  assert (select count(*) from campana_email_outbox where order_id = (select id from campana_ordenes where commerce_order = 'T01')) = 1, 'T21 un solo correo';
  raise notice 'OK 08 webhook repetido -> 0 duplicados; 21 un solo correo en outbox'; end $$;

do $$ declare p uuid := pg_temp.t_part('h09','i@x.cl'); ok boolean := false; begin
  perform pg_temp.t_orden(p, array['BLAZE'], 'T09');
  begin perform pg_temp.t_pagar('T09', 'pay01'); exception when others then ok := sqlerrm like '%payment_id_duplicado%'; end;
  assert ok and pg_temp.t_activas(p) = 0, 'T09 mismo payment id en otra orden debe rechazarse';
  raise notice 'OK 09 mismo payment ID dos veces -> rechazado, 0 entradas'; end $$;

do $$ declare p uuid := pg_temp.t_part('h10','j@x.cl'); ok boolean := false; begin
  perform pg_temp.t_orden(p, array['BLAZE'], 'T10');
  begin perform fn_confirmar_pago_campana('T10','MERCADOPAGO','pay10',100,'CLP',null,'{}'); exception when others then ok := sqlerrm like '%monto_o_moneda%'; end;
  assert ok and (select estado from campana_ordenes where commerce_order = 'T10') = 'PENDIENTE', 'T10 monto adulterado no acredita';
  raise notice 'OK 10 monto adulterado -> no acreditado'; end $$;

-- GRATUITO ---------------------------------------------------------------------
do $$ declare r jsonb; begin
  r := fn_registrar_entrada_gratis_campana(pg_temp.t_part('h11','k@x.cl'), '2026-1.0');
  assert (r->>'asignadas')::int = 3, 'T11 gratis nuevo -> 3';
  r := fn_registrar_entrada_gratis_campana(pg_temp.t_part('h01','a@x.cl'), '2026-1.0');
  assert (r->>'asignadas')::int = 2 and (r->>'total')::int = 3, 'T12 gratis con 1 -> 2';
  raise notice 'OK 11 gratis nuevo -> 3; 12 gratis con 1 -> 2'; end $$;

do $$ declare p uuid := pg_temp.t_part('h13','m@x.cl'); r jsonb; begin
  perform pg_temp.t_orden(p, array['BLAZE_NOVA'], 'T13'); perform pg_temp.t_pagar('T13','pay13');
  r := fn_registrar_entrada_gratis_campana(p, '2026-1.0');
  assert (r->>'asignadas')::int = 1, 'T13 gratis con 2 -> 1';
  r := fn_registrar_entrada_gratis_campana(p, '2026-1.0');
  assert (r->>'asignadas')::int = 0 and (r->>'total')::int = 3, 'T14 gratis con 3 -> 0';
  r := fn_registrar_entrada_gratis_campana(pg_temp.t_part('h13','distinto@x.cl'), '2026-1.0');
  assert (r->>'asignadas')::int = 0, 'T15 mismo RUT otro correo -> 0';
  raise notice 'OK 13 gratis con 2 -> 1; 14 con 3 -> 0; 15 mismo RUT otro correo -> 0'; end $$;

-- REEMBOLSO --------------------------------------------------------------------
do $$ declare p uuid := pg_temp.t_part('h01','a@x.cl'); v uuid; ultimo bigint; ok boolean := false; begin
  -- h01 tiene 1 por compra (T01) y 2 gratis.
  perform fn_marcar_pago_reembolsado_campana('T01', 'MERCADOPAGO');
  v := (select id from campana_ordenes where commerce_order = 'T01');
  assert (select estado from campana_ordenes where id = v) = 'REEMBOLSADA', 'T18 orden reembolsada';
  assert not exists (select 1 from campana_entradas where order_id = v and status = 'ACTIVE'), 'T18 entradas de la orden invalidadas';
  assert (select count(*) from campana_entradas where participant_id = p and source = 'GRATIS' and status = 'ACTIVE') = 2, 'T19 gratuitas siguen activas';
  assert (select invalidated_payment_id from campana_entradas where order_id = v limit 1) = 'pay01', 'T18 guarda referencia del pago';
  assert (select estado from campana_entregas e join campana_orden_items i on i.id = e.orden_item_id where i.orden_id = v) = 'LOCKED', 'T18 descarga bloqueada';
  select max(entry_no) into ultimo from campana_entradas;
  perform fn_registrar_entrada_gratis_campana(p, '2026-1.0');   -- recupera el cupo con un código NUEVO
  assert (select max(entry_no) from campana_entradas) = ultimo + 1, 'T20 el código nuevo no reutiliza números';
  begin update campana_entradas set status = 'ACTIVE' where order_id = v; exception when others then ok := sqlerrm like '%no_se_reactiva%'; end;
  assert ok, 'T20 una invalidada no se reactiva';
  ok := false;
  begin delete from campana_entradas where order_id = v; exception when others then ok := sqlerrm like '%no_se_puede_borrar%'; end;
  assert ok, 'T20 una participación no se borra';
  raise notice 'OK 18 refund invalida solo su orden; 19 gratuitas intactas; 20 códigos no se reciclan ni reactivan'; end $$;

-- ACTIVACIÓN -------------------------------------------------------------------
do $$ declare ok boolean := false; begin
  begin update campana_config set checkout_habilitado = true where id = 1; exception when others then ok := sqlerrm like '%configuracion_incompleta%'; end;
  assert ok, 'T23 no se puede habilitar con configuración incompleta';
  update campana_config set bases_version='2026-1.0', privacy_version='2026-1.0', inicio_at='2026-10-01', cierre_at='2026-12-11',
    sorteo_at='2026-12-12 20:00-03', premios='[{"lugar":1,"descripcion":"$100.000"}]', proveedor_pago='MERCADOPAGO', email_configurado=true where id=1;
  ok := false;
  begin update campana_config set checkout_habilitado = true where id = 1; exception when others then ok := sqlerrm like '%sin_participante%'; end;
  assert ok, 'T23 no se puede habilitar con participaciones anteriores sin participante';
  raise notice 'OK 23 activación fail-closed (configuración y participaciones anteriores)'; end $$;

-- SORTEO -----------------------------------------------------------------------
do $$ declare ok boolean := false; begin
  begin perform fn_crear_snapshot_campana('FIREHOUSE_2026','2026-1.0'); exception when others then ok := sqlerrm like '%sin_participante%'; end;
  assert ok, 'T25 el snapshot exige resolver participaciones anteriores';
  raise notice 'OK 25a snapshot bloqueado mientras existan participaciones anteriores activas'; end $$;

-- Decisión simulada solo para la prueba: invalidar las participaciones anteriores.
update campana_entradas set status = 'INVALIDATED', invalidated_at = now(), invalidated_reason = 'PRUEBA'
where participant_id is null and status = 'ACTIVE';

do $$ declare r jsonb; n integer; esperado text; ok boolean := false; begin
  r := fn_crear_snapshot_campana('FIREHOUSE_2026','2026-1.0');
  n := (r->>'total')::int;
  assert n = (select count(*) from campana_entradas where status = 'ACTIVE' and participant_id is not null), 'T25 solo ACTIVE';
  assert not exists (select 1 from campana_draw_snapshot_entries s join campana_entradas e on e.id = s.entry_id where e.status <> 'ACTIVE'), 'T25 sin invalidadas';
  assert (select min(draw_index) = 1 and max(draw_index) = n and count(*) = n from campana_draw_snapshot_entries), 'T26 draw_index consecutivo 1..N';
  select 'draw_index,public_code' || chr(10) || string_agg(draw_index || ',' || public_code, chr(10) order by draw_index)
    into esperado from campana_draw_snapshot_entries;
  assert encode(digest(esperado,'sha256'),'hex') = r->>'sha256', 'T27 hash reproducible';
  begin update campana_draw_snapshot set total = 0; exception when others then ok := sqlerrm like '%snapshot_inmutable%'; end;
  assert ok, 'T28 snapshot inmutable';
  assert (select checkout_habilitado or participacion_habilitada from campana_config where id = 1) = false, 'T18 cierre deshabilita la campaña';
  assert (fn_registrar_entrada_gratis_campana(pg_temp.t_part('h99','z@x.cl'), '2026-1.0')->>'asignadas')::int = 0, 'T18 con snapshot no se asignan nuevas';
  raise notice 'OK 25-28 snapshot: N=% sha256=%', n, r->>'sha256';
  raise notice 'CSV: %', replace(r->>'csv', chr(10), ' | ');
end $$;
