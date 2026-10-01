-- ============================================================================
-- 0016 — Asistencia por deportista y fecha de clase
-- ============================================================================
-- Hasta ahora la asistencia se guardaba de dos maneras que no se podían
-- deshacer ni consultar por fecha:
--   - clase de prueba: el caso pasaba al estado ASISTIO;
--   - primera clase Star: una nota "Asistió a su primera clase de Firehouse Star".
--
-- Qué hace (aditiva, idempotente y transaccional):
--   1. Tabla asistencias: una fila por deportista y fecha de clase. Marcar crea
--      la fila; desmarcar la borra. Solo los admin activos leen y escriben (RLS).
--   2. fn_grabar_asistencia(fecha, presentes, ausentes): graba en una sola
--      operación los cambios de una fecha desde la pantalla Clase de hoy.
--      Para las clases de prueba además mantiene el estado del caso:
--        marcar   → ASISTIO, si el caso estaba en un estado previo a la clase;
--        desmarcar → AGENDADO, si el caso estaba en ASISTIO.
--      Las inscripciones Star no cambian de estado (su estado refleja el pago).
--   2b. Un caso que pasa a ASISTIO por otra vía (visita rápida, ficha del
--      caso) también queda registrado en la tabla.
--   3. Copia a la tabla las asistencias ya registradas con el sistema anterior.
--
-- Requiere 0014. No borra ni modifica los registros anteriores.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.fn_proxima_clase_star_desde(timestamptz)') is null then
    raise exception 'Falta la migración 0014.';
  end if;
end $$;

-- 1. Tabla ---------------------------------------------------------------------
create table if not exists public.asistencias (
  id             uuid primary key default gen_random_uuid(),
  atleta_id      uuid not null references public.atletas(id) on delete cascade,
  caso_id        uuid references public.casos_crm(id) on delete set null,
  fecha          date not null,
  registrado_por uuid references public.admin_profiles(user_id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint asistencias_atleta_fecha_unica unique (atleta_id, fecha)
);

create index if not exists idx_asistencias_fecha on public.asistencias (fecha);
create index if not exists idx_asistencias_caso on public.asistencias (caso_id) where caso_id is not null;

alter table public.asistencias enable row level security;

-- Permisos explícitos (no se depende de los permisos por defecto del proyecto):
-- solo usuarios con sesión; RLS limita además a los admin activos.
revoke all on public.asistencias from public, anon;
grant select, insert, delete on public.asistencias to authenticated;

drop policy if exists admin_select_asistencias on public.asistencias;
create policy admin_select_asistencias on public.asistencias
  for select to authenticated using (is_admin());
drop policy if exists admin_insert_asistencias on public.asistencias;
create policy admin_insert_asistencias on public.asistencias
  for insert to authenticated with check (is_admin());
drop policy if exists admin_delete_asistencias on public.asistencias;
create policy admin_delete_asistencias on public.asistencias
  for delete to authenticated using (is_admin());

-- 2. Grabar los cambios de una fecha -------------------------------------------
-- p_presentes y p_ausentes: [{"atleta_id": "...", "caso_id": "..."}, ...]
-- Corre con los permisos de quien llama (security invoker): RLS se aplica.
create or replace function public.fn_grabar_asistencia(p_fecha date, p_presentes jsonb, p_ausentes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_marcadas    integer := 0;
  v_desmarcadas integer := 0;
begin
  if not is_admin() then
    raise exception 'solo_admin';
  end if;
  if p_fecha is null then
    raise exception 'fecha_requerida';
  end if;

  with nuevas as (
    insert into asistencias (atleta_id, caso_id, fecha)
    select (x->>'atleta_id')::uuid, nullif(x->>'caso_id', '')::uuid, p_fecha
    from jsonb_array_elements(coalesce(p_presentes, '[]'::jsonb)) x
    on conflict (atleta_id, fecha) do nothing
    returning 1
  )
  select count(*) into v_marcadas from nuevas;

  with borradas as (
    delete from asistencias a
    using jsonb_array_elements(coalesce(p_ausentes, '[]'::jsonb)) x
    where a.fecha = p_fecha and a.atleta_id = (x->>'atleta_id')::uuid
    returning 1
  )
  select count(*) into v_desmarcadas from borradas;

  -- Estado de las clases de prueba (el trigger registra cada cambio en la ficha).
  update casos_crm c set estado = 'ASISTIO'
  from jsonb_array_elements(coalesce(p_presentes, '[]'::jsonb)) x
  where c.id = nullif(x->>'caso_id', '')::uuid
    and c.journey in ('CLASE_PRUEBA', 'CLASE_PRUEBA_STAR')
    and c.estado in ('NUEVO', 'CONTACTADO', 'SEGUIMIENTO', 'AGENDADO', 'NO_RESPONDE');

  update casos_crm c set estado = 'AGENDADO'
  from jsonb_array_elements(coalesce(p_ausentes, '[]'::jsonb)) x
  where c.id = nullif(x->>'caso_id', '')::uuid
    and c.journey in ('CLASE_PRUEBA', 'CLASE_PRUEBA_STAR')
    and c.estado = 'ASISTIO';

  return jsonb_build_object('marcadas', v_marcadas, 'desmarcadas', v_desmarcadas);
end;
$$;

revoke all on function public.fn_grabar_asistencia(date, jsonb, jsonb) from public;
grant execute on function public.fn_grabar_asistencia(date, jsonb, jsonb) to authenticated;

-- 2b. Un caso que pasa a ASISTIO por otra vía (visita rápida, ficha del caso)
-- también queda en la tabla, con la fecha agendada o la de hoy. Si el caso ya
-- tiene una asistencia (por ejemplo, la grabada desde Clase de hoy), no se
-- agrega otra.
create or replace function public.fn_casos_asistencia_desde_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'ASISTIO' and (tg_op = 'INSERT' or old.estado is distinct from new.estado)
     and not exists (select 1 from asistencias a where a.caso_id = new.id) then
    insert into asistencias (atleta_id, caso_id, fecha, registrado_por)
    values (
      new.atleta_id, new.id,
      coalesce(new.fecha_clase_prueba, (now() at time zone 'America/Santiago')::date),
      auth.uid()
    )
    on conflict (atleta_id, fecha) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_asistencia_desde_estado on public.casos_crm;
create trigger trg_casos_asistencia_desde_estado
  after insert or update of estado on public.casos_crm
  for each row execute function public.fn_casos_asistencia_desde_estado();

-- 3. Asistencias registradas con el sistema anterior ---------------------------
-- Clases de prueba en estado ASISTIO: la fecha agendada; si no tiene, el día
-- en que pasó a ASISTIO; si tampoco, el día en que se creó (visita rápida).
insert into public.asistencias (atleta_id, caso_id, fecha, registrado_por, created_at)
select c.atleta_id, c.id,
       coalesce(
         c.fecha_clase_prueba,
         (select (max(i.fecha) at time zone 'America/Santiago')::date
            from public.interacciones i
           where i.caso_id = c.id and i.tipo = 'CAMBIO_ESTADO' and i.nota like '% a ASISTIO'),
         (c.created_at at time zone 'America/Santiago')::date
       ),
       null, now()
from public.casos_crm c
where c.estado = 'ASISTIO'
on conflict (atleta_id, fecha) do nothing;

-- Primeras clases Star registradas como nota.
insert into public.asistencias (atleta_id, caso_id, fecha, registrado_por, created_at)
select distinct on (c.atleta_id, f.fecha) c.atleta_id, c.id, f.fecha, i.responsable_id, i.fecha
from public.interacciones i
join public.casos_crm c on c.id = i.caso_id
cross join lateral (
  select coalesce(c.fecha_clase_prueba, (i.fecha at time zone 'America/Santiago')::date) as fecha
) f
where i.nota = 'Asistió a su primera clase de Firehouse Star'
order by c.atleta_id, f.fecha, i.fecha
on conflict (atleta_id, fecha) do nothing;

insert into public.schema_migraciones (version, descripcion)
values ('0016', 'asistencia por deportista y fecha de clase')
on conflict (version) do nothing;

commit;

-- Verificación: asistencias por fecha.
select fecha, count(*) as asistencias
from public.asistencias
group by fecha
order by fecha desc;
