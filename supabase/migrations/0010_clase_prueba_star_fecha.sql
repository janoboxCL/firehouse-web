-- ============================================================================
-- 0010 — Fecha de la clase de prueba Firehouse Star
-- ============================================================================
-- Problema: el formulario /registro no envía día para la clase de prueba Star
-- (el día es fijo), así que fn_crear_registro dejaba fecha_clase_prueba vacía.
-- Sin fecha, esos casos no aparecían en /admin/clase-prueba, aunque el correo
-- de confirmación sí informó la fecha de la próxima clase Star.
--
-- Qué hace (idempotente y transaccional):
--   1. fn_proxima_clase_star(fecha): próxima clase Star desde una fecha, con la
--      misma regla que getNextStarClassDate() en src/lib/crm/star-class.ts
--      (semanal, anclada a la primera clase del 3 de octubre de 2026).
--   2. Trigger: todo caso CLASE_PRUEBA_STAR sin fecha recibe la próxima clase
--      Star, día SABADO.
--   3. Completa los casos existentes con la fecha que se les informó al
--      registrarse, sin alterar su fecha de última actualización.
-- ============================================================================

begin;

-- Si cambia la primera clase Star, actualizar aquí y en src/lib/crm/star-class.ts.
create or replace function public.fn_proxima_clase_star(p_desde date)
returns date
language sql
immutable
as $$
  select case
    when p_desde <= date '2026-10-03' then date '2026-10-03'
    else date '2026-10-03' + (7 * ceil((p_desde - date '2026-10-03') / 7.0))::integer
  end;
$$;

create or replace function public.fn_casos_fecha_clase_star()
returns trigger
language plpgsql
as $$
begin
  if new.journey = 'CLASE_PRUEBA_STAR' and new.fecha_clase_prueba is null then
    new.fecha_clase_prueba := public.fn_proxima_clase_star((now() at time zone 'America/Santiago')::date);
    new.dia_clase_prueba := 'SABADO';
    new.quiere_clase_prueba := true;
    if new.proxima_accion is null or new.proxima_accion = 'Contactar apoderado' then
      new.proxima_accion := 'Confirmar clase de prueba Firehouse Star';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_fecha_clase_star on public.casos_crm;
create trigger trg_casos_fecha_clase_star
  before insert or update of journey on public.casos_crm
  for each row execute function public.fn_casos_fecha_clase_star();

alter table public.casos_crm disable trigger trg_casos_updated_at;

update public.casos_crm set
  fecha_clase_prueba  = public.fn_proxima_clase_star((created_at at time zone 'America/Santiago')::date),
  dia_clase_prueba    = 'SABADO',
  quiere_clase_prueba = true,
  proxima_accion      = case when proxima_accion is null or proxima_accion = 'Contactar apoderado'
                             then 'Confirmar clase de prueba Firehouse Star' else proxima_accion end
where journey = 'CLASE_PRUEBA_STAR' and fecha_clase_prueba is null;

alter table public.casos_crm enable trigger trg_casos_updated_at;

do $$
begin
  if to_regclass('public.schema_migraciones') is not null then
    insert into public.schema_migraciones (version, descripcion)
    values ('0010', 'fecha de la clase de prueba Firehouse Star')
    on conflict (version) do nothing;
  end if;
end $$;

commit;

-- Verificación: todas las clases de prueba Star deben tener fecha.
select journey, fecha_clase_prueba, estado, count(*) as casos
from public.casos_crm
where journey in ('CLASE_PRUEBA', 'CLASE_PRUEBA_STAR')
group by 1, 2, 3
order by 1, 2, 3;
