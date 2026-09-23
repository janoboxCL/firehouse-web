-- ============================================================================
-- 0007 — Programas, precios, periodos de inscripción e inscripciones
-- ============================================================================
-- Qué hace (todo aditivo: no borra ni modifica columnas existentes):
--   1. programas: ALL_STAR (competitivo) y STAR (iniciación).
--   2. programa_precios: matrícula y mensualidad por programa y temporada.
--   3. precios_hermanos: precio total mensual para dos hermanos, por combinación.
--   4. periodos_inscripcion: cuándo se puede inscribir alguien en cada programa
--      (distinto de cuándo empiezan las clases).
--   5. inscripciones: en qué programa está cada deportista y desde cuándo.
--      Una sola inscripción ACTIVA por deportista.
--   6. casos_crm.programa: programa del caso, separado del journey. Se completa
--      a partir del journey y se mantiene sincronizado con un trigger.
--      CLASE_PRUEBA, PRETEMPORADA y POR_CLASIFICAR quedan sin programa (a mano).
--   7. v_casos_segmento: confirmados, recontactables y archivados.
--   8. Corrige el registro de migraciones: la 0005 (Campaña 2026) no está
--      aplicada en la base y la 0006 la había marcado como aplicada.
--
-- Requisitos: migración 0006 aplicada.
-- Idempotente: se puede ejecutar más de una vez. Todo corre en una transacción:
-- si algo falla, no queda ningún cambio a medias.
-- Los valores iniciales (precios y periodos) son editables en /admin/configuracion.
-- ============================================================================

begin;

do $$
declare
  t record;
begin
  -- Si alguna de estas tablas ya existiera con otra estructura (por ejemplo,
  -- creada fuera del repositorio), se detiene todo antes de tocar nada.
  for t in
    select * from (values
      ('programas', 'codigo'),
      ('programa_precios', 'mensualidad'),
      ('precios_hermanos', 'combinacion'),
      ('periodos_inscripcion', 'clases_inician'),
      ('inscripciones', 'programa_codigo')
    ) as v(tabla, columna)
  loop
    if to_regclass('public.' || t.tabla) is not null and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t.tabla and column_name = t.columna
    ) then
      raise exception 'Ya existe una tabla "%" con otra estructura. No se aplicó ningún cambio.', t.tabla;
    end if;
  end loop;

  if to_regclass('public.schema_migraciones') is null then
    raise exception 'Falta la migración 0006. Ejecútala antes que esta.';
  end if;
  if to_regclass('public.atletas') is null or to_regclass('public.casos_crm') is null then
    raise exception 'No existen las tablas atletas o casos_crm.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    raise exception 'No existe la función set_updated_at() (migración 0001).';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Programas
-- ----------------------------------------------------------------------------
create table if not exists public.programas (
  codigo      text primary key check (codigo in ('ALL_STAR', 'STAR')),
  nombre      text not null,
  descripcion text,
  orden       smallint not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.programas (codigo, nombre, descripcion, orden) values
  ('ALL_STAR', 'Firehouse All Star', 'Equipo competitivo. 2 veces por semana, 2 horas.', 1),
  ('STAR', 'Firehouse Star', 'Programa de iniciación. 1 vez por semana, 1,5 horas.', 2)
on conflict (codigo) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Precios por programa y temporada
-- ----------------------------------------------------------------------------
create table if not exists public.programa_precios (
  id              uuid primary key default gen_random_uuid(),
  programa_codigo text not null references public.programas(codigo),
  temporada       smallint not null check (temporada between 2025 and 2100),
  matricula       integer not null check (matricula between 0 and 1000000),
  mensualidad     integer not null check (mensualidad between 0 and 1000000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (programa_codigo, temporada)
);

drop trigger if exists trg_programa_precios_updated_at on public.programa_precios;
create trigger trg_programa_precios_updated_at
  before update on public.programa_precios
  for each row execute function set_updated_at();

insert into public.programa_precios (programa_codigo, temporada, matricula, mensualidad) values
  ('ALL_STAR', 2026, 10000, 30000),
  ('STAR',     2026, 10000, 30000),
  ('ALL_STAR', 2027, 10000, 30000),
  ('STAR',     2027, 10000, 30000)
on conflict (programa_codigo, temporada) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Precio hermanos (total mensual para dos hermanos)
-- ----------------------------------------------------------------------------
create table if not exists public.precios_hermanos (
  id          uuid primary key default gen_random_uuid(),
  temporada   smallint not null check (temporada between 2025 and 2100),
  combinacion text not null check (combinacion in ('ALL_STAR+ALL_STAR', 'STAR+STAR', 'ALL_STAR+STAR')),
  monto_total integer not null check (monto_total between 1 and 2000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (temporada, combinacion)
);

drop trigger if exists trg_precios_hermanos_updated_at on public.precios_hermanos;
create trigger trg_precios_hermanos_updated_at
  before update on public.precios_hermanos
  for each row execute function set_updated_at();

-- Valor inicial: 2 x $45.000 en todas las combinaciones (revisar la mixta).
insert into public.precios_hermanos (temporada, combinacion, monto_total) values
  (2026, 'ALL_STAR+ALL_STAR', 45000), (2026, 'STAR+STAR', 45000), (2026, 'ALL_STAR+STAR', 45000),
  (2027, 'ALL_STAR+ALL_STAR', 45000), (2027, 'STAR+STAR', 45000), (2027, 'ALL_STAR+STAR', 45000)
on conflict (temporada, combinacion) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Periodos de inscripción
-- ----------------------------------------------------------------------------
create table if not exists public.periodos_inscripcion (
  id              uuid primary key default gen_random_uuid(),
  programa_codigo text not null references public.programas(codigo),
  nombre          text not null check (char_length(nombre) between 2 and 80),
  abre            date not null,
  cierra          date,               -- null = sin fecha de cierre
  clases_inician  date,               -- null = por definir
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (cierra is null or cierra >= abre)
);

create index if not exists idx_periodos_programa on public.periodos_inscripcion (programa_codigo, abre);

drop trigger if exists trg_periodos_inscripcion_updated_at on public.periodos_inscripcion;
create trigger trg_periodos_inscripcion_updated_at
  before update on public.periodos_inscripcion
  for each row execute function set_updated_at();

-- Valores iniciales. Las fechas de inicio de clases quedan por definir.
insert into public.periodos_inscripcion (programa_codigo, nombre, abre, cierra)
select v.programa, v.nombre, v.abre::date, v.cierra::date
from (values
  ('STAR',     'Inscripción continua', '2026-09-01', null),
  ('ALL_STAR', 'Pretemporada 2027',                     '2026-12-01', '2027-01-31'),
  ('ALL_STAR', 'Temporada 2027',                        '2027-03-01', '2027-08-31')
) as v(programa, nombre, abre, cierra)
where not exists (
  select 1 from public.periodos_inscripcion p
  where p.programa_codigo = v.programa and p.nombre = v.nombre
);

-- ----------------------------------------------------------------------------
-- 5. Inscripciones
-- ----------------------------------------------------------------------------
create table if not exists public.inscripciones (
  id                      uuid primary key default gen_random_uuid(),
  -- restrict: una inscripción nunca desaparece en silencio al borrar un deportista.
  atleta_id               uuid not null references public.atletas(id) on delete restrict,
  programa_codigo         text not null references public.programas(codigo),
  temporada               smallint not null check (temporada between 2025 and 2100),
  estado                  text not null default 'ACTIVA' check (estado in ('ACTIVA', 'FINALIZADA', 'ANULADA')),
  fecha_alta              date not null default current_date,
  fecha_baja              date,
  motivo_baja             text,
  origen                  text not null default 'NUEVO'
                            check (origen in ('NUEVO', 'RENOVACION', 'CAMBIO_PROGRAMA', 'CARGA_INICIAL')),
  inscripcion_anterior_id uuid references public.inscripciones(id),
  caso_id                 uuid references public.casos_crm(id) on delete set null,
  notas                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (estado <> 'FINALIZADA' or fecha_baja is not null),
  check (fecha_baja is null or fecha_baja >= fecha_alta)
);

create unique index if not exists uq_inscripcion_activa_por_atleta
  on public.inscripciones (atleta_id) where estado = 'ACTIVA';
create index if not exists idx_inscripciones_programa on public.inscripciones (programa_codigo, estado);

drop trigger if exists trg_inscripciones_updated_at on public.inscripciones;
create trigger trg_inscripciones_updated_at
  before update on public.inscripciones
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Programa en casos_crm (separado del journey)
-- ----------------------------------------------------------------------------
alter table public.casos_crm
  add column if not exists programa text references public.programas(codigo);

create index if not exists idx_casos_programa on public.casos_crm (programa);

-- Debe coincidir con programaDesdeJourney() en src/lib/crm/programas.ts.
create or replace function public.fn_programa_desde_journey(p_journey text)
returns text
language sql
immutable
as $$
  select case
    when p_journey in ('RENOVACION_2027', 'EXPERIMENTADA_2027', 'PRINCIPIANTE_2027') then 'ALL_STAR'
    when p_journey in ('CLASE_PRUEBA_STAR', 'FIREHOUSE_STAR') then 'STAR'
    else null
  end;
$$;

-- Completa el programa en casos nuevos y cuando cambia el journey. Si el journey
-- no determina un programa (PRETEMPORADA, POR_CLASIFICAR), respeta el valor manual.
create or replace function public.fn_casos_sincronizar_programa()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.programa := coalesce(public.fn_programa_desde_journey(new.journey), new.programa);
  elsif new.journey is distinct from old.journey then
    new.programa := coalesce(public.fn_programa_desde_journey(new.journey), new.programa);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_sincronizar_programa on public.casos_crm;
create trigger trg_casos_sincronizar_programa
  before insert or update of journey on public.casos_crm
  for each row execute function public.fn_casos_sincronizar_programa();

-- Completa los casos existentes (solo los que aún no tienen programa), sin
-- alterar su fecha de última actualización.
alter table public.casos_crm disable trigger trg_casos_updated_at;

update public.casos_crm
set programa = public.fn_programa_desde_journey(journey)
where programa is null
  and public.fn_programa_desde_journey(journey) is not null;

alter table public.casos_crm enable trigger trg_casos_updated_at;

-- ----------------------------------------------------------------------------
-- 7. Segmento de casos: confirmados, recontactables y archivados
-- ----------------------------------------------------------------------------
create or replace view public.v_casos_segmento
with (security_invoker = true) as
select
  c.id as caso_id,
  c.atleta_id,
  c.journey,
  c.programa,
  c.estado,
  case
    when c.estado = 'INSCRITO' then 'CONFIRMADO'
    when c.estado in ('NO_INTERESADO', 'NO_CONTINUA') then 'ARCHIVADO'
    else 'RECONTACTABLE'
  end as segmento,
  c.created_at
from public.casos_crm c;

-- ----------------------------------------------------------------------------
-- RLS: solo administradores activos
-- ----------------------------------------------------------------------------
alter table public.programas            enable row level security;
alter table public.programa_precios     enable row level security;
alter table public.precios_hermanos     enable row level security;
alter table public.periodos_inscripcion enable row level security;
alter table public.inscripciones        enable row level security;

drop policy if exists admin_select_programas on public.programas;
create policy admin_select_programas on public.programas
  for select to authenticated using (is_admin());

drop policy if exists admin_select_programa_precios on public.programa_precios;
drop policy if exists admin_insert_programa_precios on public.programa_precios;
drop policy if exists admin_update_programa_precios on public.programa_precios;
create policy admin_select_programa_precios on public.programa_precios
  for select to authenticated using (is_admin());
create policy admin_insert_programa_precios on public.programa_precios
  for insert to authenticated with check (is_admin());
create policy admin_update_programa_precios on public.programa_precios
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_select_precios_hermanos on public.precios_hermanos;
drop policy if exists admin_insert_precios_hermanos on public.precios_hermanos;
drop policy if exists admin_update_precios_hermanos on public.precios_hermanos;
create policy admin_select_precios_hermanos on public.precios_hermanos
  for select to authenticated using (is_admin());
create policy admin_insert_precios_hermanos on public.precios_hermanos
  for insert to authenticated with check (is_admin());
create policy admin_update_precios_hermanos on public.precios_hermanos
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_select_periodos on public.periodos_inscripcion;
drop policy if exists admin_insert_periodos on public.periodos_inscripcion;
drop policy if exists admin_update_periodos on public.periodos_inscripcion;
drop policy if exists admin_delete_periodos on public.periodos_inscripcion;
create policy admin_select_periodos on public.periodos_inscripcion
  for select to authenticated using (is_admin());
create policy admin_insert_periodos on public.periodos_inscripcion
  for insert to authenticated with check (is_admin());
create policy admin_update_periodos on public.periodos_inscripcion
  for update to authenticated using (is_admin()) with check (is_admin());
create policy admin_delete_periodos on public.periodos_inscripcion
  for delete to authenticated using (is_admin());

-- Inscripciones: sin política de borrado. Se anulan, no se eliminan.
drop policy if exists admin_select_inscripciones on public.inscripciones;
drop policy if exists admin_insert_inscripciones on public.inscripciones;
drop policy if exists admin_update_inscripciones on public.inscripciones;
create policy admin_select_inscripciones on public.inscripciones
  for select to authenticated using (is_admin());
create policy admin_insert_inscripciones on public.inscripciones
  for insert to authenticated with check (is_admin());
create policy admin_update_inscripciones on public.inscripciones
  for update to authenticated using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 8. Corrección: la 0005 no está aplicada (verificado con /admin/esquema el
--    23/9/2026: faltan campana_participantes, campana_email_outbox y las
--    columnas nuevas de campana_config).
-- ----------------------------------------------------------------------------
delete from public.schema_migraciones where version = '0005' and retroactiva;

insert into public.schema_migraciones (version, descripcion)
values ('0007', 'programas, precios, periodos de inscripción, inscripciones y casos_crm.programa')
on conflict (version) do nothing;

commit;

-- Verificación: una fila por programa del caso y cuántos casos tiene.
-- Los casos sin programa (CLASE_PRUEBA, PRETEMPORADA, POR_CLASIFICAR) se asignan a mano.
select coalesce(programa, '(sin programa)') as programa, count(*) as casos
from public.casos_crm
group by 1
order by 1;
