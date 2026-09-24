-- ============================================================================
-- 0011 — Cuenta corriente familiar (cargos, pagos y link de pago)
-- ============================================================================
-- Modelo definitivo de cobros, activado por ahora para Firehouse Star:
--   conceptos_cobro  catálogo: inscripción, mensualidad, uniforme, pack, cargo manual
--   cargos           lo que se debe: uno por concepto, deportista y período
--   pagos            lo que se paga: Mercado Pago, efectivo o transferencia
--   pago_detalle     qué parte de cada pago se aplica a qué cargo
--   links_pago       link personal de cada familia (token secreto)
--
-- Reglas en la base:
--   - Una mensualidad por deportista y mes; una inscripción por deportista,
--     programa y temporada (los cargos anulados no cuentan).
--   - Inscripción y mensualidad se pagan completas.
--   - Si hay mensualidades vencidas, la más antigua debe incluirse en el pago.
--   - Confirmar un pago es idempotente y valida monto y moneda.
--   - Al pagarse una inscripción se crea la inscripción del deportista y su
--     caso Star pasa a "Inscrito".
--
-- Aditiva, idempotente y transaccional. Requiere 0007.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.programas') is null then
    raise exception 'Falta la migración 0007.';
  end if;
end $$;

-- 1. Catálogo -------------------------------------------------------------------
create table if not exists public.conceptos_cobro (
  codigo text primary key check (codigo in ('INSCRIPCION', 'MENSUALIDAD', 'UNIFORME', 'PACK_COMPETITIVO', 'CARGO_MANUAL')),
  nombre text not null,
  tipo   text not null check (tipo in ('UNICO', 'MENSUAL', 'ABONABLE')),
  orden  smallint not null default 0
);

insert into public.conceptos_cobro (codigo, nombre, tipo, orden) values
  ('INSCRIPCION', 'Inscripción', 'UNICO', 1),
  ('MENSUALIDAD', 'Mensualidad', 'MENSUAL', 2),
  ('UNIFORME', 'Uniforme', 'ABONABLE', 3),
  ('PACK_COMPETITIVO', 'Pack competitivo', 'ABONABLE', 4),
  ('CARGO_MANUAL', 'Cargo manual', 'UNICO', 5)
on conflict (codigo) do nothing;

-- 2. Cargos ------------------------------------------------------------------------
create table if not exists public.cargos (
  id               uuid primary key default gen_random_uuid(),
  apoderado_id     uuid not null references public.apoderados(id) on delete restrict,
  atleta_id        uuid references public.atletas(id) on delete restrict,
  programa_codigo  text references public.programas(codigo),
  concepto_codigo  text not null references public.conceptos_cobro(codigo),
  temporada        smallint not null check (temporada between 2025 and 2100),
  periodo          date check (periodo is null or extract(day from periodo) = 1),
  descripcion      text not null check (char_length(descripcion) between 3 and 200),
  monto            integer not null check (monto between 1 and 2000000),
  monto_lista      integer,
  vencimiento      date,
  estado           text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'PARCIAL', 'PAGADO', 'ANULADO')),
  anulado_motivo   text,
  anulado_at       timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (concepto_codigo <> 'MENSUALIDAD' or periodo is not null)
);

create unique index if not exists uq_cargo_mensualidad
  on public.cargos (atleta_id, periodo) where concepto_codigo = 'MENSUALIDAD' and estado <> 'ANULADO';
create unique index if not exists uq_cargo_inscripcion
  on public.cargos (atleta_id, programa_codigo, temporada) where concepto_codigo = 'INSCRIPCION' and estado <> 'ANULADO';
create index if not exists idx_cargos_familia on public.cargos (apoderado_id, estado);

drop trigger if exists trg_cargos_updated_at on public.cargos;
create trigger trg_cargos_updated_at before update on public.cargos
  for each row execute function set_updated_at();

-- 3. Pagos -------------------------------------------------------------------------
create table if not exists public.pagos (
  id                     uuid primary key default gen_random_uuid(),
  apoderado_id           uuid not null references public.apoderados(id) on delete restrict,
  commerce_order         text not null unique,
  medio                  text not null check (medio in ('MERCADOPAGO', 'FLOW', 'EFECTIVO', 'TRANSFERENCIA')),
  monto_total            integer not null check (monto_total > 0),
  estado                 text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO', 'REEMBOLSADO')),
  pasarela_payment_id    text,
  referencia_externa     text,
  referencia             text,
  metodo_pago            text,
  datos_json             jsonb,
  folio_boleta           text,
  comprobante_enviado_at timestamptz,
  registrado_por         uuid,
  created_at             timestamptz not null default now(),
  aprobado_at            timestamptz,
  updated_at             timestamptz not null default now()
);

create unique index if not exists uq_pagos_pasarela
  on public.pagos (medio, pasarela_payment_id) where pasarela_payment_id is not null;
create index if not exists idx_pagos_familia on public.pagos (apoderado_id, estado);

drop trigger if exists trg_pagos_updated_at on public.pagos;
create trigger trg_pagos_updated_at before update on public.pagos
  for each row execute function set_updated_at();

create table if not exists public.pago_detalle (
  pago_id  uuid not null references public.pagos(id) on delete restrict,
  cargo_id uuid not null references public.cargos(id) on delete restrict,
  monto    integer not null check (monto > 0),
  primary key (pago_id, cargo_id)
);
create index if not exists idx_pago_detalle_cargo on public.pago_detalle (cargo_id);

-- 4. Link personal de pago ------------------------------------------------------
create table if not exists public.links_pago (
  apoderado_id  uuid primary key references public.apoderados(id) on delete cascade,
  token         text not null unique check (char_length(token) >= 32),
  created_at    timestamptz not null default now(),
  revocado_at   timestamptz,
  ultimo_uso_at timestamptz
);

-- 5. Saldo de cada cargo (solo cuentan los pagos aprobados) -----------------------
create or replace view public.v_cargos_saldo
with (security_invoker = true) as
select
  c.*,
  coalesce((
    select sum(d.monto) from public.pago_detalle d
    join public.pagos p on p.id = d.pago_id
    where d.cargo_id = c.id and p.estado = 'APROBADO'
  ), 0)::integer as pagado,
  c.monto - coalesce((
    select sum(d.monto) from public.pago_detalle d
    join public.pagos p on p.id = d.pago_id
    where d.cargo_id = c.id and p.estado = 'APROBADO'
  ), 0)::integer as saldo
from public.cargos c;

-- 6. Funciones ----------------------------------------------------------------------

-- Recalcula el estado de los cargos a partir de sus pagos aprobados.
create or replace function public.fn_recalcular_cargos(p_cargo_ids uuid[])
returns void
language sql
as $$
  update public.cargos c set estado = case
      when s.pagado >= c.monto then 'PAGADO'
      when s.pagado > 0 then 'PARCIAL'
      else 'PENDIENTE'
    end
  from public.v_cargos_saldo s
  where s.id = c.id and c.id = any(p_cargo_ids) and c.estado <> 'ANULADO';
$$;

-- Crea un pago PENDIENTE por el saldo completo de los cargos elegidos.
create or replace function public.fn_crear_pago_cuenta(
  p_apoderado_id   uuid,
  p_cargo_ids      uuid[],
  p_medio          text,
  p_commerce_order text,
  p_registrado_por uuid default null,
  p_referencia     text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_total   integer;
  v_validos integer;
  v_pago_id uuid;
  v_vencida uuid;
begin
  if p_cargo_ids is null or cardinality(p_cargo_ids) = 0 then
    raise exception 'sin_cargos';
  end if;

  perform 1 from public.cargos where id = any(p_cargo_ids) for update;

  select count(*), coalesce(sum(saldo), 0) into v_validos, v_total
  from public.v_cargos_saldo
  where id = any(p_cargo_ids) and apoderado_id = p_apoderado_id
    and estado in ('PENDIENTE', 'PARCIAL') and saldo > 0;

  if v_validos <> cardinality(p_cargo_ids) then
    raise exception 'cargos_invalidos';
  end if;

  select id into v_vencida from public.v_cargos_saldo
  where apoderado_id = p_apoderado_id and concepto_codigo = 'MENSUALIDAD'
    and estado in ('PENDIENTE', 'PARCIAL') and vencimiento < (now() at time zone 'America/Santiago')::date
  order by periodo, created_at limit 1;
  if v_vencida is not null and not (v_vencida = any(p_cargo_ids)) then
    raise exception 'debe_incluir_mensualidad_vencida_mas_antigua';
  end if;

  insert into public.pagos (apoderado_id, commerce_order, medio, monto_total, registrado_por, referencia)
  values (p_apoderado_id, p_commerce_order, p_medio, v_total, p_registrado_por, p_referencia)
  returning id into v_pago_id;

  insert into public.pago_detalle (pago_id, cargo_id, monto)
  select v_pago_id, id, saldo from public.v_cargos_saldo where id = any(p_cargo_ids);

  return jsonb_build_object('pago_id', v_pago_id, 'monto_total', v_total, 'commerce_order', p_commerce_order);
end;
$$;

-- Aplica un pago aprobado: estados de cargos, inscripción y caso Star.
create or replace function public.fn_aplicar_pago_cuenta(p_pago_id uuid)
returns void
language plpgsql
as $$
declare
  v_cargos uuid[];
  r record;
begin
  select array_agg(cargo_id) into v_cargos from public.pago_detalle where pago_id = p_pago_id;
  perform public.fn_recalcular_cargos(v_cargos);

  for r in
    select c.* from public.cargos c
    where c.id = any(v_cargos) and c.concepto_codigo = 'INSCRIPCION' and c.estado = 'PAGADO' and c.atleta_id is not null
  loop
    if not exists (select 1 from public.inscripciones where atleta_id = r.atleta_id and estado = 'ACTIVA') then
      insert into public.inscripciones (atleta_id, programa_codigo, temporada, origen, caso_id)
      values (r.atleta_id, r.programa_codigo, r.temporada, 'NUEVO',
        (select id from public.casos_crm where atleta_id = r.atleta_id and programa = r.programa_codigo
         order by created_at desc limit 1));
    end if;

    update public.casos_crm set estado = 'INSCRITO'
    where atleta_id = r.atleta_id and programa = r.programa_codigo
      and estado not in ('INSCRITO', 'NO_INTERESADO', 'NO_CONTINUA');
  end loop;

  insert into public.interacciones (caso_id, tipo, nota, fecha)
  select distinct on (c.atleta_id)
    k.id, 'NOTA',
    'Pago recibido: ' || (select string_agg(c2.descripcion, ', ' order by c2.descripcion)
                          from public.cargos c2 where c2.id = any(v_cargos) and c2.atleta_id = c.atleta_id),
    now()
  from public.cargos c
  join public.casos_crm k on k.atleta_id = c.atleta_id
  where c.id = any(v_cargos)
  order by c.atleta_id, k.created_at desc;
end;
$$;

-- Confirmación desde el webhook: idempotente, valida monto y moneda.
create or replace function public.fn_confirmar_pago_cuenta(
  p_commerce_order      text,
  p_pasarela_payment_id text,
  p_monto               integer,
  p_moneda              text,
  p_metodo_pago         text,
  p_datos_json          jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_pago public.pagos%rowtype;
begin
  select * into v_pago from public.pagos where commerce_order = p_commerce_order for update;
  if not found then
    raise exception 'pago_no_existe';
  end if;

  if v_pago.estado = 'APROBADO' then
    if v_pago.pasarela_payment_id is distinct from p_pasarela_payment_id then
      raise exception 'payment_id_distinto_para_pago_aprobado';
    end if;
    return jsonb_build_object('pago_id', v_pago.id, 'repetido', true);
  end if;

  if p_monto is distinct from v_pago.monto_total or p_moneda is distinct from 'CLP' then
    raise exception 'monto_o_moneda_no_coincide';
  end if;

  update public.pagos set estado = 'APROBADO', pasarela_payment_id = p_pasarela_payment_id,
    metodo_pago = p_metodo_pago, datos_json = p_datos_json, aprobado_at = now()
  where id = v_pago.id;

  perform public.fn_aplicar_pago_cuenta(v_pago.id);
  return jsonb_build_object('pago_id', v_pago.id, 'repetido', false);
exception
  when unique_violation then
    raise exception 'payment_id_duplicado';
end;
$$;

-- Pago en efectivo o transferencia, registrado desde el panel.
create or replace function public.fn_registrar_pago_manual(
  p_apoderado_id   uuid,
  p_cargo_ids      uuid[],
  p_medio          text,
  p_referencia     text,
  p_registrado_por uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_res jsonb;
begin
  if p_medio not in ('EFECTIVO', 'TRANSFERENCIA') then
    raise exception 'medio_invalido';
  end if;
  v_res := public.fn_crear_pago_cuenta(
    p_apoderado_id, p_cargo_ids, p_medio,
    'MANUAL-' || to_char(now() at time zone 'America/Santiago', 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 6),
    p_registrado_por, p_referencia);
  update public.pagos set estado = 'APROBADO', aprobado_at = now() where id = (v_res->>'pago_id')::uuid;
  perform public.fn_aplicar_pago_cuenta((v_res->>'pago_id')::uuid);
  return v_res;
end;
$$;

create or replace function public.fn_marcar_pago_cuenta_no_aprobado(p_commerce_order text, p_estado text)
returns void
language sql
as $$
  update public.pagos set estado = case when p_estado = 'PENDIENTE' then 'PENDIENTE' else 'RECHAZADO' end
  where commerce_order = p_commerce_order and estado = 'PENDIENTE';
$$;

-- Reembolso: el pago deja de contar y los cargos vuelven a quedar pendientes.
create or replace function public.fn_marcar_pago_cuenta_reembolsado(p_commerce_order text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
  v_cargos uuid[];
begin
  update public.pagos set estado = 'REEMBOLSADO' where commerce_order = p_commerce_order returning id into v_id;
  if v_id is null then return; end if;
  select array_agg(cargo_id) into v_cargos from public.pago_detalle where pago_id = v_id;
  perform public.fn_recalcular_cargos(v_cargos);
end;
$$;

-- 7. Seguridad: lectura solo para administradores; escritura solo desde el servidor
alter table public.conceptos_cobro enable row level security;
alter table public.cargos          enable row level security;
alter table public.pagos           enable row level security;
alter table public.pago_detalle    enable row level security;
alter table public.links_pago      enable row level security;

drop policy if exists admin_select_conceptos_cobro on public.conceptos_cobro;
create policy admin_select_conceptos_cobro on public.conceptos_cobro for select to authenticated using (is_admin());
drop policy if exists admin_select_cargos on public.cargos;
create policy admin_select_cargos on public.cargos for select to authenticated using (is_admin());
drop policy if exists admin_select_pagos on public.pagos;
create policy admin_select_pagos on public.pagos for select to authenticated using (is_admin());
drop policy if exists admin_select_pago_detalle on public.pago_detalle;
create policy admin_select_pago_detalle on public.pago_detalle for select to authenticated using (is_admin());
drop policy if exists admin_select_links_pago on public.links_pago;
create policy admin_select_links_pago on public.links_pago for select to authenticated using (is_admin());

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'fn_recalcular_cargos', 'fn_crear_pago_cuenta', 'fn_aplicar_pago_cuenta', 'fn_confirmar_pago_cuenta',
      'fn_registrar_pago_manual', 'fn_marcar_pago_cuenta_no_aprobado', 'fn_marcar_pago_cuenta_reembolsado')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;

insert into public.schema_migraciones (version, descripcion)
values ('0011', 'cuenta corriente familiar: cargos, pagos y link de pago')
on conflict (version) do nothing;

commit;

-- Verificación: debe listar los 5 conceptos de cobro.
select codigo, nombre, tipo from public.conceptos_cobro order by orden;
