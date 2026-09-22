-- Campaña Firehouse 2026: esquema reproducible e incremental.
-- No elimina datos. El despliegue permanece fail-closed (checkout=false) hasta
-- que una persona responsable complete y valide toda campana_config.
create extension if not exists pgcrypto;

create sequence if not exists public.campana_entry_no_seq;

create table if not exists public.campana_config (
  id integer primary key default 1 check (id = 1),
  campaign_id text not null default 'FIREHOUSE_2026',
  checkout_habilitado boolean not null default false,
  participacion_habilitada boolean not null default false,
  bases_version text,
  privacy_version text,
  inicio_at timestamptz,
  cierre_at timestamptz,
  sorteo_at timestamptz,
  premios jsonb,
  proveedor_pago text,
  email_configurado boolean not null default false,
  schema_version integer not null default 5,
  updated_at timestamptz not null default now()
);
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
insert into public.campana_config(id) values (1) on conflict (id) do nothing;

create table if not exists public.campana_pasarelas (
  id text primary key,
  habilitada boolean not null default false,
  preferida boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.campana_participantes (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  identity_hash text not null,
  rut_masked text not null,
  nombre text not null,
  email text not null,
  telefono text,
  bases_version text not null,
  bases_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, identity_hash)
);

create table if not exists public.campana_ordenes (
  id uuid primary key default gen_random_uuid(),
  commerce_order text not null unique,
  participant_id uuid references public.campana_participantes(id),
  comprador_nombre text not null,
  comprador_email text not null,
  comprador_telefono text,
  rifa_codigo_id uuid,
  monto integer not null check (monto >= 0),
  estado text not null default 'PENDIENTE',
  bases_version text,
  bases_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.campana_ordenes add column if not exists participant_id uuid references public.campana_participantes(id);
alter table public.campana_ordenes add column if not exists bases_version text;
alter table public.campana_ordenes add column if not exists bases_accepted_at timestamptz;

create table if not exists public.campana_orden_items (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.campana_ordenes(id),
  producto text not null check (producto in ('BLAZE','NOVA','BLAZE_NOVA')),
  precio integer not null,
  created_at timestamptz not null default now()
);
create table if not exists public.campana_entregas (
  id uuid primary key default gen_random_uuid(),
  orden_item_id uuid not null unique references public.campana_orden_items(id),
  estado text not null default 'LOCKED',
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.campana_pagos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.campana_ordenes(id),
  pasarela text not null,
  referencia_externa text,
  pasarela_payment_id text,
  monto integer not null,
  moneda text not null default 'CLP',
  estado text not null default 'PENDIENTE',
  metodo_pago text,
  datos_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campana_pagos add column if not exists updated_at timestamptz not null default now();
create unique index if not exists campana_pagos_payment_id_uniq
  on public.campana_pagos(pasarela, pasarela_payment_id) where pasarela_payment_id is not null;

create table if not exists public.campana_entradas_gratis (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.campana_participantes(id),
  nombre_completo text,
  rut text,
  email text,
  telefono text,
  bases_version text,
  bases_accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.campana_entradas_gratis add column if not exists participant_id uuid references public.campana_participantes(id);
alter table public.campana_entradas_gratis add column if not exists bases_version text;
alter table public.campana_entradas_gratis add column if not exists bases_accepted_at timestamptz;

create table if not exists public.campana_entradas (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.campana_participantes(id),
  source text,
  origen text,
  order_id uuid references public.campana_ordenes(id),
  orden_item_id uuid references public.campana_orden_items(id),
  entrada_gratis_id uuid references public.campana_entradas_gratis(id),
  entry_no bigint,
  codigo text,
  status text not null default 'ACTIVE',
  bases_version text,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_reason text,
  invalidated_payment_id text
);
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
create unique index if not exists campana_entradas_codigo_uniq on public.campana_entradas(codigo);
create unique index if not exists campana_entradas_entry_no_uniq on public.campana_entradas(entry_no) where entry_no is not null;
create unique index if not exists campana_entradas_compra_idempotente on public.campana_entradas(order_id, entry_no) where source = 'COMPRA';

create table if not exists public.campana_email_outbox (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('CONFIRMACION_COMPRA','PARTICIPACION_GRATIS')),
  order_id uuid references public.campana_ordenes(id),
  participant_id uuid references public.campana_participantes(id),
  destinatario text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists campana_outbox_compra_uniq on public.campana_email_outbox(tipo, order_id) where order_id is not null;
create unique index if not exists campana_outbox_gratis_uniq on public.campana_email_outbox(tipo, participant_id) where participant_id is not null and tipo='PARTICIPACION_GRATIS';

create table if not exists public.campana_draw_snapshot (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null unique,
  closed_at timestamptz not null default now(),
  total integer not null,
  csv_sha256 text not null,
  bases_version text not null,
  csv_content text not null,
  is_closed boolean not null default true
);
create table if not exists public.campana_draw_snapshot_entries (
  snapshot_id uuid not null references public.campana_draw_snapshot(id),
  draw_index integer not null check (draw_index > 0),
  entry_id uuid not null references public.campana_entradas(id),
  public_code text not null,
  participant_id uuid not null references public.campana_participantes(id),
  primary key(snapshot_id, draw_index), unique(snapshot_id, entry_id)
);

create or replace function public.fn_asignar_participaciones_campana(
  p_participant_id uuid, p_origen text, p_solicitadas integer,
  p_orden_id uuid default null, p_bases_version text default '2026-1.0'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_activas integer; v_asignar integer; v_no bigint; v_codes text[] := '{}';
begin
  if p_origen not in ('COMPRA','GRATIS') or p_solicitadas < 0 then raise exception 'solicitud_invalida'; end if;
  perform 1 from campana_participantes where id=p_participant_id for update;
  if not found then raise exception 'participante_no_existe'; end if;
  select count(*) into v_activas from campana_entradas where participant_id=p_participant_id and status='ACTIVE';
  v_asignar := least(p_solicitadas, greatest(0, 3-v_activas));
  for i in 1..v_asignar loop
    v_no := nextval('campana_entry_no_seq');
    insert into campana_entradas(participant_id,source,origen,order_id,entry_no,codigo,status,bases_version)
    values(p_participant_id,p_origen,p_origen,p_orden_id,v_no,'FH26-'||lpad(v_no::text,6,'0'),'ACTIVE',p_bases_version);
    v_codes := array_append(v_codes,'FH26-'||lpad(v_no::text,6,'0'));
  end loop;
  return jsonb_build_object('solicitadas',p_solicitadas,'asignadas',v_asignar,'total',v_activas+v_asignar,'codigos',to_jsonb(v_codes));
end $$;

create or replace function public.fn_registrar_entrada_gratis_campana(
  p_participant_id uuid, p_bases_version text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_email text;
begin
  select email into v_email from campana_participantes where id=p_participant_id;
  v_result := fn_asignar_participaciones_campana(p_participant_id,'GRATIS',3,null,p_bases_version);
  insert into campana_email_outbox(tipo,participant_id,destinatario,payload)
  values('PARTICIPACION_GRATIS',p_participant_id,v_email,v_result)
  on conflict do nothing;
  return v_result;
end $$;

create or replace function public.fn_confirmar_pago_campana(
 p_commerce_order text,p_pasarela text,p_pasarela_payment_id text,p_monto integer,p_moneda text,
 p_metodo_pago text,p_datos_json jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order campana_ordenes%rowtype; v_pago campana_pagos%rowtype; v_solicitadas integer; v_result jsonb;
begin
 select * into v_order from campana_ordenes where commerce_order=p_commerce_order for update;
 if not found then raise exception 'orden_no_existe'; end if;
 select * into v_pago from campana_pagos where orden_id=v_order.id and pasarela=p_pasarela for update;
 if p_monto<>v_order.monto or p_moneda<>'CLP' then raise exception 'monto_o_moneda_no_coincide'; end if;
 if v_pago.estado='APROBADO' then
   select jsonb_build_object('solicitadas',count(*),'asignadas',count(*),'total',(select count(*) from campana_entradas where participant_id=v_order.participant_id and status='ACTIVE'),'codigos',coalesce(jsonb_agg(codigo order by entry_no),'[]'::jsonb)) into v_result from campana_entradas where order_id=v_order.id;
   return v_result;
 end if;
 update campana_pagos set estado='APROBADO',pasarela_payment_id=p_pasarela_payment_id,metodo_pago=p_metodo_pago,datos_json=p_datos_json,updated_at=now() where id=v_pago.id;
 update campana_ordenes set estado='PAGADA',paid_at=now() where id=v_order.id;
 update campana_entregas set estado='AVAILABLE',unlocked_at=now() where orden_item_id in(select id from campana_orden_items where orden_id=v_order.id);
 select coalesce(sum(case producto when 'BLAZE_NOVA' then 2 else 1 end),0)::integer into v_solicitadas from campana_orden_items where orden_id=v_order.id;
 v_result:=fn_asignar_participaciones_campana(v_order.participant_id,'COMPRA',v_solicitadas,v_order.id,v_order.bases_version);
 insert into campana_email_outbox(tipo,order_id,participant_id,destinatario,payload) values('CONFIRMACION_COMPRA',v_order.id,v_order.participant_id,v_order.comprador_email,v_result) on conflict do nothing;
 return v_result;
exception when unique_violation then
 raise exception 'payment_id_duplicado';
end $$;

create or replace function public.fn_marcar_pago_reembolsado_campana(p_commerce_order text,p_pasarela text)
returns void language plpgsql security definer set search_path=public as $$
declare v_order uuid; v_payment text;
begin
 select o.id,p.pasarela_payment_id into v_order,v_payment from campana_ordenes o join campana_pagos p on p.orden_id=o.id where o.commerce_order=p_commerce_order and p.pasarela=p_pasarela for update of o,p;
 update campana_pagos set estado='REEMBOLSADO',updated_at=now() where orden_id=v_order and pasarela=p_pasarela;
 update campana_ordenes set estado='REEMBOLSADA' where id=v_order;
 update campana_entradas set status='INVALIDATED',invalidated_at=now(),invalidated_reason='PAYMENT_REFUND',invalidated_payment_id=v_payment where order_id=v_order and source='COMPRA' and status='ACTIVE';
end $$;

create or replace function public.fn_crear_snapshot_campana(p_campaign_id text,p_bases_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_csv text; v_hash text; v_total integer;
begin
 perform pg_advisory_xact_lock(hashtext('snapshot:'||p_campaign_id));
 if exists(select 1 from campana_draw_snapshot where campaign_id=p_campaign_id) then raise exception 'snapshot_ya_cerrado'; end if;
 update campana_config set participacion_habilitada=false,checkout_habilitado=false,updated_at=now() where campaign_id=p_campaign_id;
 select 'draw_index,public_code'||chr(10)||coalesce(string_agg(draw_index||','||codigo,chr(10) order by draw_index),'')
 into v_csv from (select row_number() over(order by entry_no,id) draw_index,codigo from campana_entradas where status='ACTIVE') s;
 select count(*) into v_total from campana_entradas where status='ACTIVE';
 v_hash:=encode(digest(v_csv,'sha256'),'hex');
 insert into campana_draw_snapshot(id,campaign_id,total,csv_sha256,bases_version,csv_content) values(v_id,p_campaign_id,v_total,v_hash,p_bases_version,v_csv);
 insert into campana_draw_snapshot_entries(snapshot_id,draw_index,entry_id,public_code,participant_id)
 select v_id,row_number() over(order by entry_no,id),id,codigo,participant_id from campana_entradas where status='ACTIVE' order by entry_no,id;
 return jsonb_build_object('snapshot_id',v_id,'total',v_total,'sha256',v_hash,'csv',v_csv);
end $$;

create or replace function public.fn_campana_config_valida(p_identity_secret_configured boolean)
returns boolean language sql stable as $$
 select checkout_habilitado is false or (
   bases_version is not null and privacy_version is not null and inicio_at is not null and cierre_at is not null
   and sorteo_at is not null and jsonb_array_length(coalesce(premios,'[]'))>0 and proveedor_pago is not null
   and email_configurado and schema_version>=5 and p_identity_secret_configured
 ) from public.campana_config where id=1
$$;

create or replace function public.campana_prevent_snapshot_mutation() returns trigger language plpgsql as $$
begin raise exception 'snapshot_inmutable'; end $$;
drop trigger if exists campana_snapshot_inmutable on public.campana_draw_snapshot;
create trigger campana_snapshot_inmutable before update or delete on public.campana_draw_snapshot for each row execute function public.campana_prevent_snapshot_mutation();
drop trigger if exists campana_snapshot_entries_inmutable on public.campana_draw_snapshot_entries;
create trigger campana_snapshot_entries_inmutable before update or delete on public.campana_draw_snapshot_entries for each row execute function public.campana_prevent_snapshot_mutation();

revoke all on function public.fn_asignar_participaciones_campana(uuid,text,integer,uuid,text) from public,anon,authenticated;
revoke all on function public.fn_crear_snapshot_campana(text,text) from public,anon,authenticated;
