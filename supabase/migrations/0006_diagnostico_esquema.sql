-- ============================================================================
-- 0006 — Diagnóstico de esquema y registro de migraciones
-- ============================================================================
-- Qué hace:
--   1. Crea schema_migraciones: desde ahora cada migración se registra aquí,
--      para que /admin/esquema muestre cuáles están aplicadas.
--   2. Crea fn_diagnostico_esquema(): describe tablas, columnas, restricciones,
--      índices, políticas RLS, triggers, funciones y vistas del esquema public.
--      No lee datos de ninguna tabla.
--
-- Seguridad: la función solo puede ejecutarla service_role (la Function de
-- Cloudflare). anon y authenticated no tienen permiso. Es SECURITY DEFINER para
-- ver todo el catálogo aunque alguna tabla no tenga permisos para service_role;
-- solo lee metadatos, nunca filas.
--
-- Es idempotente: se puede ejecutar más de una vez sin efectos adicionales.
-- Todo corre en una transacción: si algo falla, no queda ningún cambio a medias.
-- ============================================================================

begin;

create table if not exists public.schema_migraciones (
  version     text primary key,
  descripcion text not null,
  aplicada_at timestamptz not null default now(),
  retroactiva boolean not null default false
);

alter table public.schema_migraciones enable row level security;

drop policy if exists admin_select_schema_migraciones on public.schema_migraciones;
create policy admin_select_schema_migraciones on public.schema_migraciones
  for select to authenticated using (is_admin());

-- Migraciones anteriores del repositorio, registradas de forma retroactiva.
-- "retroactiva = true" significa que no se verificó cuándo se aplicaron.
-- La 0005 (Campaña 2026) NO se incluye: el diagnóstico del 23/9/2026 mostró que
-- no está aplicada en la base.
insert into public.schema_migraciones (version, descripcion, retroactiva) values
  ('0001', 'init (registrada retroactivamente)', true),
  ('0002', 'star_confirmacion_email (registrada retroactivamente)', true),
  ('0003', 'plantilla_whatsapp_star (registrada retroactivamente)', true),
  ('0004', 'clase_prueba_star_journey (registrada retroactivamente)', true)
on conflict (version) do nothing;

create or replace function public.fn_diagnostico_esquema()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'version_postgres', current_setting('server_version'),

    'tablas', coalesce((
      select jsonb_agg(jsonb_build_object('tabla', table_name, 'tipo', table_type) order by table_name)
      from information_schema.tables
      where table_schema = 'public'
    ), '[]'::jsonb),

    'columnas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tabla', table_name,
        'columna', column_name,
        'tipo', case when data_type = 'USER-DEFINED' then udt_name else data_type end,
        'nulable', is_nullable = 'YES',
        'por_defecto', column_default
      ) order by table_name, ordinal_position)
      from information_schema.columns
      where table_schema = 'public'
    ), '[]'::jsonb),

    'restricciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tabla', cl.relname,
        'nombre', co.conname,
        'tipo', co.contype,
        'definicion', pg_get_constraintdef(co.oid)
      ) order by cl.relname, co.conname)
      from pg_constraint co
      join pg_class cl on cl.oid = co.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public'
    ), '[]'::jsonb),

    'indices', coalesce((
      select jsonb_agg(jsonb_build_object('tabla', tablename, 'nombre', indexname, 'definicion', indexdef)
                       order by tablename, indexname)
      from pg_indexes
      where schemaname = 'public'
    ), '[]'::jsonb),

    'rls', coalesce((
      select jsonb_agg(jsonb_build_object('tabla', cl.relname, 'activa', cl.relrowsecurity) order by cl.relname)
      from pg_class cl
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relkind = 'r'
    ), '[]'::jsonb),

    'politicas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tabla', tablename, 'nombre', policyname, 'comando', cmd,
        'roles', roles, 'usando', qual, 'verificacion', with_check
      ) order by tablename, policyname)
      from pg_policies
      where schemaname = 'public'
    ), '[]'::jsonb),

    'triggers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tabla', cl.relname, 'nombre', t.tgname, 'definicion', pg_get_triggerdef(t.oid)
      ) order by cl.relname, t.tgname)
      from pg_trigger t
      join pg_class cl on cl.oid = t.tgrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
    ), '[]'::jsonb),

    'funciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', p.proname,
        'argumentos', pg_get_function_identity_arguments(p.oid),
        'security_definer', p.prosecdef,
        'definicion', pg_get_functiondef(p.oid)
      ) order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and not exists (
          select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
        )
    ), '[]'::jsonb),

    'vistas', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', viewname, 'definicion', definition) order by viewname)
      from pg_views
      where schemaname = 'public'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fn_diagnostico_esquema() from public;
revoke all on function public.fn_diagnostico_esquema() from anon;
revoke all on function public.fn_diagnostico_esquema() from authenticated;
grant execute on function public.fn_diagnostico_esquema() to service_role;

insert into public.schema_migraciones (version, descripcion)
values ('0006', 'diagnostico_esquema: schema_migraciones + fn_diagnostico_esquema')
on conflict (version) do nothing;

commit;

-- Verificación: debe devolver una fila con migracion_0006 = true y funciones > 0.
select
  exists (select 1 from public.schema_migraciones where version = '0006') as migracion_0006,
  jsonb_array_length(public.fn_diagnostico_esquema() -> 'funciones') as funciones;
