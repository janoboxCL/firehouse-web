-- ============================================================================
-- 0013 — Menú de pagos: familias de prueba y kits Star pagados en el registro
-- ============================================================================
-- Qué hace (aditiva, idempotente y transaccional):
--   1. apoderados.es_prueba: marca una familia usada para probar pagos. El
--      menú de pagos la deja fuera de los totales (se puede mostrar aparte).
--   2. fn_registrar_kit_star_en_cuenta(orden): pasa a la cuenta de la familia
--      un Kit de Iniciación pagado por el registro Star (star_ordenes):
--        - crea el cargo "Inscripción Firehouse Star" de cada deportista de la
--          orden, o usa el que ya exista pendiente (así no se cobra dos veces);
--        - crea el pago aprobado con el mismo número de orden y el id de
--          Mercado Pago del registro;
--        - deja la inscripción del deportista activa.
--      Se ejecuta desde el menú de pagos, familia por familia. Si se repite,
--      no hace nada (la orden ya está registrada).
--
-- No toca el registro Star ni su confirmación de pago. Requiere 0011.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.cargos') is null then
    raise exception 'Falta la migración 0011.';
  end if;
end $$;

-- 1. Familias de prueba ------------------------------------------------------------
alter table public.apoderados add column if not exists es_prueba boolean not null default false;

-- 2. Kit Star pagado en el registro → cuenta de la familia -----------------------
create or replace function public.fn_registrar_kit_star_en_cuenta(
  p_orden_id       uuid,
  p_registrado_por uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_orden     public.star_ordenes%rowtype;
  v_mp        public.star_pagos%rowtype;
  v_temporada smallint;
  v_n         integer;
  v_base      integer;
  v_resto     integer;
  v_parte     integer;
  v_cargo     public.v_cargos_saldo%rowtype;
  v_cargo_id  uuid;
  v_pago_id   uuid;
  v_total     integer := 0;
  v_cargos    uuid[] := '{}';
  v_omitidos  text[] := '{}';
  v_aprobado  timestamptz;
  r           record;
  i           integer := 0;
begin
  select * into v_orden from public.star_ordenes where id = p_orden_id for update;
  if not found then raise exception 'orden_no_existe'; end if;
  if v_orden.estado <> 'PAGADA' then raise exception 'orden_no_pagada'; end if;
  if v_orden.apoderado_id is null then raise exception 'orden_sin_apoderado'; end if;

  -- Idempotencia: la orden ya se registró en la cuenta.
  if exists (select 1 from public.pagos where commerce_order = v_orden.commerce_order) then
    return jsonb_build_object('repetido', true);
  end if;

  select * into v_mp from public.star_pagos
  where orden_id = v_orden.id and estado = 'APROBADO'
  order by updated_at desc limit 1;
  v_aprobado := coalesce(v_mp.updated_at, v_orden.updated_at, v_orden.created_at);

  -- Misma temporada que usa el panel: la de la primera clase Star.
  v_temporada := extract(year from public.fn_proxima_clase_star((v_orden.created_at at time zone 'America/Santiago')::date))::smallint;

  select count(*) into v_n from public.star_orden_atletas where orden_id = v_orden.id and atleta_id is not null;
  if v_n = 0 then raise exception 'orden_sin_deportistas'; end if;
  v_base := v_orden.monto / v_n;
  v_resto := v_orden.monto - v_base * v_n;

  insert into public.pagos (apoderado_id, commerce_order, medio, monto_total, estado, pasarela_payment_id,
                            referencia_externa, referencia, metodo_pago, registrado_por, created_at, aprobado_at)
  values (v_orden.apoderado_id, v_orden.commerce_order, 'MERCADOPAGO', v_orden.monto, 'APROBADO', v_mp.pasarela_payment_id,
          v_mp.referencia_externa, 'Kit pagado en el registro Firehouse Star', v_mp.metodo_pago, p_registrado_por,
          v_orden.created_at, v_aprobado)
  returning id into v_pago_id;

  for r in
    select distinct on (atleta_id) atleta_id from public.star_orden_atletas
    where orden_id = v_orden.id and atleta_id is not null
    order by atleta_id
  loop
    i := i + 1;
    v_parte := v_base + case when i = 1 then v_resto else 0 end;

    select * into v_cargo from public.v_cargos_saldo
    where atleta_id = r.atleta_id and programa_codigo = 'STAR' and concepto_codigo = 'INSCRIPCION'
      and temporada = v_temporada and estado <> 'ANULADO';

    if found and v_cargo.saldo <= 0 then
      -- Ya estaba pagada en la cuenta (posible doble pago): no se aplica.
      v_omitidos := v_omitidos || r.atleta_id::text;
      continue;
    end if;

    if found then
      v_cargo_id := v_cargo.id;
      v_parte := least(v_parte, v_cargo.saldo);
    else
      insert into public.cargos (apoderado_id, atleta_id, programa_codigo, concepto_codigo, temporada,
                                 descripcion, monto, monto_lista, vencimiento, created_by, created_at)
      values (v_orden.apoderado_id, r.atleta_id, 'STAR', 'INSCRIPCION', v_temporada,
              'Inscripción Firehouse Star ' || v_temporada || ' (Kit de Iniciación)', v_parte, v_parte,
              (v_orden.created_at at time zone 'America/Santiago')::date, p_registrado_por, v_orden.created_at)
      returning id into v_cargo_id;
    end if;

    insert into public.pago_detalle (pago_id, cargo_id, monto) values (v_pago_id, v_cargo_id, v_parte);
    v_total := v_total + v_parte;
    v_cargos := v_cargos || v_cargo_id;
  end loop;

  if v_total = 0 then
    -- Todas las inscripciones ya estaban pagadas: la excepción deshace todo.
    raise exception 'inscripciones_ya_pagadas';
  end if;

  update public.pagos set monto_total = v_total where id = v_pago_id;
  perform public.fn_recalcular_cargos(v_cargos);

  -- Inscripción activa y nota en el caso de cada deportista.
  insert into public.inscripciones (atleta_id, programa_codigo, temporada, origen, caso_id, fecha_alta, notas)
  select c.atleta_id, 'STAR', v_temporada, 'CARGA_INICIAL',
         (select k.id from public.casos_crm k where k.atleta_id = c.atleta_id order by k.created_at desc limit 1),
         (v_aprobado at time zone 'America/Santiago')::date,
         'Kit pagado en el registro Firehouse Star (' || v_orden.commerce_order || ')'
  from public.cargos c
  where c.id = any(v_cargos)
    and not exists (select 1 from public.inscripciones i2 where i2.atleta_id = c.atleta_id and i2.estado = 'ACTIVA');

  insert into public.interacciones (caso_id, tipo, nota, responsable_id, fecha)
  select distinct on (c.atleta_id) k.id, 'NOTA',
         'Kit pagado en el registro Star registrado en la cuenta de pagos', p_registrado_por, now()
  from public.cargos c
  join public.casos_crm k on k.atleta_id = c.atleta_id
  where c.id = any(v_cargos)
  order by c.atleta_id, k.created_at desc;

  return jsonb_build_object('repetido', false, 'pago_id', v_pago_id, 'monto', v_total,
                            'cargos', to_jsonb(v_cargos), 'omitidos', to_jsonb(v_omitidos));
end;
$$;

revoke all on function public.fn_registrar_kit_star_en_cuenta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_registrar_kit_star_en_cuenta(uuid, uuid) to service_role;

insert into public.schema_migraciones (version, descripcion)
values ('0013', 'menú de pagos: familias de prueba y kits Star del registro en la cuenta')
on conflict (version) do nothing;

commit;

-- Verificación: kits pagados en el registro Star y si ya están en la cuenta.
select o.commerce_order, o.apoderado_nombre, o.monto,
       exists (select 1 from public.pagos p where p.commerce_order = o.commerce_order) as en_cuenta
from public.star_ordenes o
where o.estado = 'PAGADA'
order by o.created_at;
