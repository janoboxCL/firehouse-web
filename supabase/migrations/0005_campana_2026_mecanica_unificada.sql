-- ============================================================================
-- 0005 — Campaña Firehouse 2026: mecánica promocional unificada
-- ============================================================================
-- Versión corregida (23/9/2026) de la migración creada el 22/9/2026. La versión
-- original nunca se aplicó y no era compatible con el esquema real:
--   - la restricción campana_entradas_origen_coherente impedía insertar
--     participaciones con la nueva mecánica;
--   - fn_confirmar_pago_campana cambiaba su tipo de retorno sin eliminarla antes;
--   - la entrega usaba el estado 'AVAILABLE', que la tabla y la página de
--     descarga no reconocen ('READY');
--   - el reembolso usaba el estado de orden 'REEMBOLSADA', no permitido;
--   - las tablas nuevas (con nombre, correo y teléfono) quedaban sin RLS, y las
--     funciones SECURITY DEFINER quedaban ejecutables con la clave pública;
--   - el cierre del sorteo no encontraba digest() de pgcrypto en Supabase.
--
-- Mecánica (sin cambios respecto de lo definido): máximo 3 participaciones
-- ACTIVAS por persona/RUT sumando compra y modalidad gratuita. BLAZE y NOVA
-- solicitan 1, BLAZE_NOVA solicita 2, la vía gratuita solicita 3. La compra
-- nunca se rechaza por el límite: el producto se entrega igual.
--
-- No elimina datos. Todo corre en una transacción: si algo falla, no queda
-- ningún cambio a medias. Es idempotente.
-- Deja la campaña cerrada (fail-closed): no se puede habilitar checkout ni
-- participación gratuita hasta completar toda la configuración.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.campana_ordenes') is null
     or to_regclass('public.campana_entradas') is null
     or to_regclass('public.campana_config') is null then
    raise exception 'No existen las tablas base de la Campaña 2026.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Configuración
-- ----------------------------------------------------------------------------
alter table public.campana_config add column if not exists campaign_id text not null default 'FIREHOUSE_2026';
alter table public.campana_config add column if not exists participacion_habilitada boolean not null default false;
alter table public.campana_config add column if not exists bases_version text;
alter table public.campana_config add column if not exists privacy_version text;
alter table public.campana_config add column if not exists inicio_at timestamptz;
alter table public.campana_config add column if not exists cierre_at timestamptz;
alter table public.campana_config add column if not exists sorteo_at timestamptz;
alter table public.campana_config add column if not exists premios jsonb;
alter table public.campana_config add column if not exists proveedor_pago text;
alter table public.campana_config add column if not exists email_configurado boolean not null default false;
alter table public.campana_config add column if not exists schema_version integer not null default 5;
alter table public.campana_config add column if not exists updated_at timestamptz not null default now();
insert into public.campana_config (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Participantes: una fila por persona/RUT y campaña
-- ----------------------------------------------------------------------------
create table if not exists public.campana_participantes (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       text not null,
  identity_hash     text not null,                 -- HMAC-SHA256 del RUT normalizado
  rut_masked        text not null,                 -- ej.: 12.***.***-5
  nombre            text not null,
  email             text not null,
  telefono          text,
  bases_version     text not null,
  bases_accepted_at timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id, identity_hash)
);

-- ----------------------------------------------------------------------------
-- 3. Órdenes, pagos y entregas (tablas existentes)
-- ----------------------------------------------------------------------------
alter table public.campana_ordenes add column if not exists participant_id uuid references public.campana_participantes(id);
alter table public.campana_ordenes add column if not exists bases_version text;
alter table public.campana_ordenes add column if not exists bases_accepted_at timestamptz;
create index if not exists campana_ordenes_participante_idx on public.campana_ordenes (participant_id);

alter table public.campana_ordenes drop constraint if exists campana_ordenes_estado_check;
alter table public.campana_ordenes add constraint campana_ordenes_estado_check
  check (estado in ('PENDIENTE', 'PAGADA', 'RECHAZADA', 'ANULADA', 'EXPIRADA', 'REEMBOLSADA'));

alter table public.campana_pagos add column if not exists updated_at timestamptz not null default now();

-- Un mismo pago de la pasarela no puede acreditar dos compras. En producción ya
-- existe como restricción; se crea solo si falta.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'campana_pagos'
      and indexdef ilike '%(pasarela, pasarela_payment_id)%' and indexdef ilike '%unique%'
  ) then
    create unique index campana_pagos_payment_id_uniq
      on public.campana_pagos (pasarela, pasarela_payment_id) where pasarela_payment_id is not null;
  end if;
end $$;

alter table public.campana_entregas add column if not exists unlocked_at timestamptz;

-- ----------------------------------------------------------------------------
-- 4. Participaciones
-- ----------------------------------------------------------------------------
alter table public.campana_entradas_gratis add column if not exists participant_id uuid references public.campana_participantes(id);
alter table public.campana_entradas_gratis add column if not exists bases_version text;
alter table public.campana_entradas_gratis add column if not exists bases_accepted_at timestamptz;

alter table public.campana_entradas add column if not exists participant_id uuid references public.campana_participantes(id);
alter table public.campana_entradas add column if not exists source text;
alter table public.campana_entradas add column if not exists order_id uuid references public.campana_ordenes(id);
alter table public.campana_entradas add column if not exists entry_no bigint;
alter table public.campana_entradas add column if not exists bases_version text;
alter table public.campana_entradas add column if not exists invalidated_at timestamptz;
alter table public.campana_entradas add column if not exists invalidated_reason text;
alter table public.campana_entradas add column if not exists invalidated_payment_id text;
alter table public.campana_entradas alter column orden_item_id drop not null;
alter table public.campana_entradas alter column entrada_gratis_id drop not null;

-- La restricción anterior exigía orden_item_id (compra) o entrada_gratis_id
-- (gratis). La mecánica unificada vincula la participación a la orden y al
-- participante. Los registros anteriores (sin participante) se conservan tal cual.
alter table public.campana_entradas drop constraint if exists campana_entradas_origen_coherente;
alter table public.campana_entradas add constraint campana_entradas_origen_coherente check (
  participant_id is null
  or (source = 'COMPRA' and origen = 'COMPRA' and order_id is not null)
  or (source = 'GRATIS' and origen = 'GRATIS' and order_id is null)
);

alter table public.campana_entradas drop constraint if exists campana_entradas_source_check;
alter table public.campana_entradas add constraint campana_entradas_source_check
  check (source is null or source in ('COMPRA', 'GRATIS'));

create sequence if not exists public.campana_entry_no_seq;
create unique index if not exists campana_entradas_entry_no_uniq on public.campana_entradas (entry_no) where entry_no is not null;
create index if not exists campana_entradas_participante_idx on public.campana_entradas (participant_id, status);
create index if not exists campana_entradas_orden_idx on public.campana_entradas (order_id);

-- El código ya es único en producción (campana_entradas_codigo_key); se crea solo si falta.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'campana_entradas'
      and indexdef ilike '%unique%' and indexdef ilike '%(codigo)%'
  ) then
    create unique index campana_entradas_codigo_uniq on public.campana_entradas (codigo);
  end if;
end $$;

-- Una participación nunca se borra ni se reactiva, y su código no cambia.
create or replace function public.campana_entradas_proteger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'participacion_no_se_puede_borrar';
  end if;
  if old.status = 'INVALIDATED' and new.status <> 'INVALIDATED' then
    raise exception 'participacion_invalidada_no_se_reactiva';
  end if;
  if new.codigo is distinct from old.codigo or new.entry_no is distinct from old.entry_no then
    raise exception 'codigo_de_participacion_inmutable';
  end if;
  return new;
end;
$$;

drop trigger if exists campana_entradas_proteger on public.campana_entradas;
create trigger campana_entradas_proteger
  before update or delete on public.campana_entradas
  for each row execute function public.campana_entradas_proteger();

-- ----------------------------------------------------------------------------
-- 5. Correos (outbox): un solo correo por compra y por participante gratuito
-- ----------------------------------------------------------------------------
create table if not exists public.campana_email_outbox (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('CONFIRMACION_COMPRA', 'PARTICIPACION_GRATIS')),
  order_id       uuid references public.campana_ordenes(id),
  participant_id uuid references public.campana_participantes(id),
  destinatario   text not null,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts       integer not null default 0,
  last_error     text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists campana_outbox_compra_uniq
  on public.campana_email_outbox (tipo, order_id) where order_id is not null;
create unique index if not exists campana_outbox_gratis_uniq
  on public.campana_email_outbox (tipo, participant_id) where participant_id is not null and tipo = 'PARTICIPACION_GRATIS';

-- ----------------------------------------------------------------------------
-- 6. Snapshot del sorteo (inmutable)
-- ----------------------------------------------------------------------------
create table if not exists public.campana_draw_snapshot (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   text not null unique,
  closed_at     timestamptz not null default now(),
  total         integer not null,
  csv_sha256    text not null,
  bases_version text not null,
  csv_content   text not null,
  is_closed     boolean not null default true
);

create table if not exists public.campana_draw_snapshot_entries (
  snapshot_id    uuid not null references public.campana_draw_snapshot(id),
  draw_index     integer not null check (draw_index > 0),
  entry_id       uuid not null references public.campana_entradas(id),
  public_code    text not null,
  participant_id uuid not null references public.campana_participantes(id),
  primary key (snapshot_id, draw_index),
  unique (snapshot_id, entry_id)
);

create or replace function public.campana_prevent_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'snapshot_inmutable';
end;
$$;

drop trigger if exists campana_snapshot_inmutable on public.campana_draw_snapshot;
create trigger campana_snapshot_inmutable
  before update or delete on public.campana_draw_snapshot
  for each row execute function public.campana_prevent_snapshot_mutation();

drop trigger if exists campana_snapshot_entries_inmutable on public.campana_draw_snapshot_entries;
create trigger campana_snapshot_entries_inmutable
  before update or delete on public.campana_draw_snapshot_entries
  for each row execute function public.campana_prevent_snapshot_mutation();

-- ----------------------------------------------------------------------------
-- 7. RLS de las tablas nuevas: solo administradores leen; solo el servidor escribe
-- ----------------------------------------------------------------------------
alter table public.campana_participantes         enable row level security;
alter table public.campana_email_outbox          enable row level security;
alter table public.campana_draw_snapshot         enable row level security;
alter table public.campana_draw_snapshot_entries enable row level security;

drop policy if exists admin_select_campana_participantes on public.campana_participantes;
create policy admin_select_campana_participantes on public.campana_participantes
  for select to authenticated using (is_admin());

drop policy if exists admin_select_campana_email_outbox on public.campana_email_outbox;
create policy admin_select_campana_email_outbox on public.campana_email_outbox
  for select to authenticated using (is_admin());

drop policy if exists admin_select_campana_draw_snapshot on public.campana_draw_snapshot;
create policy admin_select_campana_draw_snapshot on public.campana_draw_snapshot
  for select to authenticated using (is_admin());

drop policy if exists admin_select_campana_draw_snapshot_entries on public.campana_draw_snapshot_entries;
create policy admin_select_campana_draw_snapshot_entries on public.campana_draw_snapshot_entries
  for select to authenticated using (is_admin());

-- ----------------------------------------------------------------------------
-- 8. Asignador único de participaciones (compra y gratis)
-- ----------------------------------------------------------------------------
-- El bloqueo FOR UPDATE sobre la fila del participante serializa cualquier
-- asignación concurrente para el mismo RUT: la segunda transacción espera a que
-- la primera termine y cuenta sus participaciones ya confirmadas. Por eso dos
-- webhooks o dos envíos simultáneos nunca producen una cuarta participación.
create or replace function public.fn_asignar_participaciones_campana(
  p_participant_id uuid,
  p_origen         text,
  p_solicitadas    integer,
  p_orden_id       uuid default null,
  p_bases_version  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign text;
  v_activas  integer;
  v_asignar  integer;
  v_no       bigint;
  v_codigo   text;
  v_codigos  text[] := '{}';
begin
  if p_origen not in ('COMPRA', 'GRATIS') or p_solicitadas is null or p_solicitadas < 0 then
    raise exception 'solicitud_invalida';
  end if;
  if p_origen = 'COMPRA' and p_orden_id is null then
    raise exception 'compra_sin_orden';
  end if;

  select campaign_id into v_campaign
  from campana_participantes where id = p_participant_id
  for update;
  if not found then
    raise exception 'participante_no_existe';
  end if;

  select count(*) into v_activas
  from campana_entradas
  where participant_id = p_participant_id and status = 'ACTIVE';

  v_asignar := least(p_solicitadas, greatest(0, 3 - v_activas));

  -- Con el sorteo cerrado no se generan participaciones nuevas.
  if exists (select 1 from campana_draw_snapshot where campaign_id = v_campaign) then
    v_asignar := 0;
  end if;

  for i in 1..v_asignar loop
    v_no := nextval('campana_entry_no_seq');
    v_codigo := 'FH26-' || lpad(v_no::text, 6, '0');
    insert into campana_entradas (participant_id, source, origen, order_id, entry_no, codigo, status, bases_version)
    values (p_participant_id, p_origen, p_origen, case when p_origen = 'COMPRA' then p_orden_id end,
            v_no, v_codigo, 'ACTIVE', p_bases_version);
    v_codigos := array_append(v_codigos, v_codigo);
  end loop;

  return jsonb_build_object(
    'solicitadas', p_solicitadas,
    'asignadas',   v_asignar,
    'total',       v_activas + v_asignar,
    'codigos',     to_jsonb(v_codigos)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Participación gratuita
-- ----------------------------------------------------------------------------
drop function if exists public.fn_registrar_entrada_gratis_campana(text, text, text, text);

create or replace function public.fn_registrar_entrada_gratis_campana(
  p_participant_id uuid,
  p_bases_version  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_result jsonb;
begin
  select email into v_email from campana_participantes where id = p_participant_id;
  if v_email is null then
    raise exception 'participante_no_existe';
  end if;

  v_result := fn_asignar_participaciones_campana(p_participant_id, 'GRATIS', 3, null, p_bases_version);

  insert into campana_email_outbox (tipo, participant_id, destinatario, payload)
  values ('PARTICIPACION_GRATIS', p_participant_id, v_email, v_result)
  on conflict do nothing;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Confirmación de pago
-- ----------------------------------------------------------------------------
-- Cambia el tipo de retorno (antes SETOF campana_entradas), así que se elimina primero.
drop function if exists public.fn_confirmar_pago_campana(text, text, text, integer, text, text, jsonb);

create function public.fn_confirmar_pago_campana(
  p_commerce_order      text,
  p_pasarela            text,
  p_pasarela_payment_id text,
  p_monto               integer,
  p_moneda              text,
  p_metodo_pago         text,
  p_datos_json          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       campana_ordenes%rowtype;
  v_pago        campana_pagos%rowtype;
  v_solicitadas integer;
  v_result      jsonb;
begin
  -- El bloqueo de la orden hace que dos webhooks del mismo pago se procesen en fila.
  select * into v_order from campana_ordenes where commerce_order = p_commerce_order for update;
  if not found then
    raise exception 'orden_no_existe';
  end if;

  select * into v_pago from campana_pagos where orden_id = v_order.id and pasarela = p_pasarela for update;
  if not found then
    raise exception 'pago_no_encontrado';
  end if;

  if p_monto is distinct from v_order.monto or p_moneda is distinct from 'CLP' then
    raise exception 'monto_o_moneda_no_coincide';
  end if;

  -- Idempotencia: un webhook repetido devuelve lo ya asignado, sin crear nada.
  if v_pago.estado = 'APROBADO' then
    if v_pago.pasarela_payment_id is distinct from p_pasarela_payment_id then
      raise exception 'payment_id_distinto_para_orden_ya_pagada';
    end if;
    select jsonb_build_object(
      'solicitadas', coalesce((select sum(case producto when 'BLAZE_NOVA' then 2 else 1 end)
                               from campana_orden_items where orden_id = v_order.id), 0),
      'asignadas',   count(*),
      'total',       (select count(*) from campana_entradas
                      where participant_id = v_order.participant_id and status = 'ACTIVE'),
      'codigos',     coalesce(jsonb_agg(codigo order by entry_no), '[]'::jsonb),
      'repetido',    true
    ) into v_result
    from campana_entradas where order_id = v_order.id;
    return v_result;
  end if;

  if v_order.participant_id is null then
    raise exception 'orden_sin_participante';
  end if;

  update campana_pagos set
    estado = 'APROBADO', pasarela_payment_id = p_pasarela_payment_id, metodo_pago = p_metodo_pago,
    datos_json = p_datos_json, aprobado_at = now(), updated_at = now()
  where id = v_pago.id;

  update campana_ordenes set estado = 'PAGADA', paid_at = now() where id = v_order.id;

  -- El producto se libera siempre, con o sin participaciones disponibles.
  update campana_entregas set estado = 'READY', unlocked_at = now()
  where orden_item_id in (select id from campana_orden_items where orden_id = v_order.id)
    and estado = 'LOCKED';

  select coalesce(sum(case producto when 'BLAZE_NOVA' then 2 else 1 end), 0)::integer
  into v_solicitadas
  from campana_orden_items where orden_id = v_order.id;

  v_result := fn_asignar_participaciones_campana(
    v_order.participant_id, 'COMPRA', v_solicitadas, v_order.id, v_order.bases_version);

  insert into campana_email_outbox (tipo, order_id, participant_id, destinatario, payload)
  values ('CONFIRMACION_COMPRA', v_order.id, v_order.participant_id, v_order.comprador_email, v_result)
  on conflict do nothing;

  return v_result;
exception
  when unique_violation then
    raise exception 'payment_id_duplicado';
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Reembolso, reversa o contracargo
-- ----------------------------------------------------------------------------
-- Invalida solo las participaciones de esa orden (nunca las gratuitas), bloquea
-- la descarga y conserva todo el historial.
create or replace function public.fn_marcar_pago_reembolsado_campana(
  p_commerce_order text,
  p_pasarela       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_payment  text;
begin
  select o.id into v_order_id from campana_ordenes o where o.commerce_order = p_commerce_order for update;
  if v_order_id is null then
    raise exception 'orden_no_encontrada';
  end if;

  select pasarela_payment_id into v_payment
  from campana_pagos where orden_id = v_order_id and pasarela = p_pasarela for update;

  update campana_pagos set estado = 'REEMBOLSADO', updated_at = now()
  where orden_id = v_order_id and pasarela = p_pasarela;

  update campana_ordenes set estado = 'REEMBOLSADA' where id = v_order_id;

  update campana_entradas set
    status = 'INVALIDATED', invalidated_at = now(),
    invalidated_reason = 'PAYMENT_REFUND', invalidated_payment_id = v_payment
  where status = 'ACTIVE'
    and (
      (order_id = v_order_id and source = 'COMPRA')
      -- participaciones anteriores a la mecánica unificada, ligadas al ítem
      or orden_item_id in (select id from campana_orden_items where orden_id = v_order_id)
    );

  update campana_entregas set estado = 'LOCKED'
  where orden_item_id in (select id from campana_orden_items where orden_id = v_order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. Cierre y snapshot del sorteo
-- ----------------------------------------------------------------------------
create or replace function public.fn_crear_snapshot_campana(
  p_campaign_id   text,
  p_bases_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id         uuid := gen_random_uuid();
  v_csv        text;
  v_hash       text;
  v_total      integer;
  v_pendientes integer;
begin
  perform pg_advisory_xact_lock(hashtext('snapshot:' || p_campaign_id));

  if exists (select 1 from campana_draw_snapshot where campaign_id = p_campaign_id) then
    raise exception 'snapshot_ya_cerrado';
  end if;

  if exists (select 1 from campana_entradas where status = 'ACTIVE' and participant_id is null) then
    raise exception 'hay_participaciones_activas_sin_participante';
  end if;

  -- 1. Impedir nuevas participaciones.
  update campana_config set participacion_habilitada = false, checkout_habilitado = false, updated_at = now()
  where campaign_id = p_campaign_id;

  -- 2. Listado definitivo: solo ACTIVE de esta campaña, orden determinista.
  create temporary table tmp_snapshot on commit drop as
  select row_number() over (order by e.entry_no, e.id)::integer as draw_index,
         e.id as entry_id, e.codigo, e.participant_id
  from campana_entradas e
  join campana_participantes p on p.id = e.participant_id
  where e.status = 'ACTIVE' and p.campaign_id = p_campaign_id;

  select count(*) into v_total from tmp_snapshot;
  select 'draw_index,public_code' || chr(10)
         || coalesce(string_agg(draw_index || ',' || codigo, chr(10) order by draw_index), '')
  into v_csv from tmp_snapshot;
  v_hash := encode(digest(v_csv, 'sha256'), 'hex');

  insert into campana_draw_snapshot (id, campaign_id, total, csv_sha256, bases_version, csv_content)
  values (v_id, p_campaign_id, v_total, v_hash, p_bases_version, v_csv);

  insert into campana_draw_snapshot_entries (snapshot_id, draw_index, entry_id, public_code, participant_id)
  select v_id, draw_index, entry_id, codigo, participant_id from tmp_snapshot;

  select count(*) into v_pendientes from campana_pagos where estado = 'PENDIENTE';

  return jsonb_build_object(
    'snapshot_id', v_id, 'total', v_total, 'sha256', v_hash, 'csv', v_csv,
    'pagos_pendientes_al_cierre', v_pendientes
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 13. Activación fail-closed
-- ----------------------------------------------------------------------------
-- El secreto de identidad (CAMPAIGN_IDENTITY_SECRET) vive en Cloudflare y lo
-- verifica el código; aquí se valida todo lo que vive en la base.
create or replace function public.fn_campana_config_valida(p_identity_secret_configured boolean)
returns boolean
language sql
stable
as $$
  select checkout_habilitado is false or (
    bases_version is not null and privacy_version is not null
    and inicio_at is not null and cierre_at is not null and sorteo_at is not null
    and jsonb_typeof(premios) = 'array' and jsonb_array_length(premios) > 0
    and proveedor_pago is not null and email_configurado and schema_version >= 5
    and p_identity_secret_configured
  )
  from public.campana_config where id = 1
$$;

create or replace function public.campana_config_validar_activacion()
returns trigger
language plpgsql
as $$
begin
  if new.checkout_habilitado or new.participacion_habilitada then
    if new.bases_version is null or new.privacy_version is null
       or new.inicio_at is null or new.cierre_at is null or new.sorteo_at is null
       or new.inicio_at >= new.cierre_at or new.cierre_at > new.sorteo_at
       or new.premios is null or jsonb_typeof(new.premios) <> 'array' or jsonb_array_length(new.premios) = 0
       or new.proveedor_pago is null or not new.email_configurado or new.schema_version < 5 then
      raise exception 'configuracion_incompleta: no se puede habilitar la campaña';
    end if;
    if exists (select 1 from public.campana_draw_snapshot where campaign_id = new.campaign_id) then
      raise exception 'campana_cerrada: el sorteo ya tiene snapshot';
    end if;
    if exists (select 1 from public.campana_entradas where status = 'ACTIVE' and participant_id is null) then
      raise exception 'hay_participaciones_activas_sin_participante: resolverlas antes de habilitar';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists campana_config_validar_activacion on public.campana_config;
create trigger campana_config_validar_activacion
  before insert or update on public.campana_config
  for each row execute function public.campana_config_validar_activacion();

-- Deja la campaña cerrada al aplicar la migración.
update public.campana_config set checkout_habilitado = false, participacion_habilitada = false where id = 1;

-- ----------------------------------------------------------------------------
-- 14. Permisos: estas funciones solo las llama el servidor (clave de servicio)
-- ----------------------------------------------------------------------------
revoke all on function public.fn_asignar_participaciones_campana(uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_registrar_entrada_gratis_campana(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_confirmar_pago_campana(text, text, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fn_marcar_pago_reembolsado_campana(text, text) from public, anon, authenticated;
revoke all on function public.fn_crear_snapshot_campana(text, text) from public, anon, authenticated;
grant execute on function public.fn_asignar_participaciones_campana(uuid, text, integer, uuid, text) to service_role;
grant execute on function public.fn_registrar_entrada_gratis_campana(uuid, text) to service_role;
grant execute on function public.fn_confirmar_pago_campana(text, text, text, integer, text, text, jsonb) to service_role;
grant execute on function public.fn_marcar_pago_reembolsado_campana(text, text) to service_role;
grant execute on function public.fn_crear_snapshot_campana(text, text) to service_role;

do $$
begin
  if to_regprocedure('public.fn_marcar_pago_no_aprobado_campana(text, text, text, text)') is not null then
    execute 'revoke all on function public.fn_marcar_pago_no_aprobado_campana(text, text, text, text) from public, anon, authenticated';
    execute 'grant execute on function public.fn_marcar_pago_no_aprobado_campana(text, text, text, text) to service_role';
  end if;
  if to_regprocedure('public.fn_generar_codigo_campana()') is not null then
    execute 'revoke all on function public.fn_generar_codigo_campana() from public, anon, authenticated';
    execute 'grant execute on function public.fn_generar_codigo_campana() to service_role';
  end if;
end $$;

do $$
begin
  if to_regclass('public.schema_migraciones') is not null then
    insert into public.schema_migraciones (version, descripcion)
    values ('0005', 'campana_2026_mecanica_unificada (versión corregida)')
    on conflict (version) do update set descripcion = excluded.descripcion, retroactiva = false, aplicada_at = now();
  end if;
end $$;

commit;

-- Verificación: la campaña queda cerrada y se informa si hay participaciones
-- anteriores sin participante (hay que resolverlas antes de habilitar).
select
  (select checkout_habilitado from public.campana_config where id = 1) as checkout_habilitado,
  (select participacion_habilitada from public.campana_config where id = 1) as participacion_habilitada,
  (select count(*) from public.campana_entradas where status = 'ACTIVE' and participant_id is null) as participaciones_anteriores_activas;
