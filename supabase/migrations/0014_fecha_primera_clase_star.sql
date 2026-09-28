-- ============================================================================
-- 0014 — Fecha de la primera clase Star: guardada, editable y con corte horario
-- ============================================================================
-- Qué hace (idempotente y transaccional):
--   1. fn_proxima_clase_star_desde(momento): próxima clase Star considerando la
--      hora. Un sábado de clase cuenta solo hasta la hora de inicio configurada;
--      quien se registra después queda para el sábado siguiente.
--   2. El trigger de casos usa esa regla y ahora también guarda la fecha de la
--      primera clase de las inscripciones Firehouse Star (registro Star), en
--      casos_crm.fecha_clase_prueba. Antes solo se calculaba al mostrarla.
--   3. Completa las inscripciones Star existentes con la fecha que se les
--      informó al registrarse, sin cambiar su fecha de última actualización.
--
-- Con la fecha guardada, el panel puede cambiarla (ej.: del 3 al 10 de octubre)
-- y ese cambio se respeta en Clase de prueba, en los mensajes y al preparar el
-- cobro. Requiere 0012.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.configuracion_academia') is null then
    raise exception 'Falta la migración 0012.';
  end if;
end $$;

-- 1. Próxima clase considerando la hora de inicio ----------------------------
create or replace function public.fn_proxima_clase_star_desde(p_momento timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local    timestamp := p_momento at time zone 'America/Santiago';
  v_dia      date := v_local::date;
  v_primera  date;
  v_inicio   time;
begin
  select star_primera_clase, star_hora_inicio into v_primera, v_inicio
  from public.configuracion_academia where id = 1;
  if v_dia >= v_primera and (v_dia - v_primera) % 7 = 0 and v_local::time >= v_inicio then
    v_dia := v_dia + 1;
  end if;
  return public.fn_proxima_clase_star(v_dia);
end;
$$;

revoke all on function public.fn_proxima_clase_star_desde(timestamptz) from public;
grant execute on function public.fn_proxima_clase_star_desde(timestamptz) to anon, authenticated, service_role;

-- 2. Trigger: prueba Star e inscripción Star reciben su fecha ------------------
create or replace function public.fn_casos_fecha_clase_star()
returns trigger
language plpgsql
as $$
begin
  if new.journey = 'CLASE_PRUEBA_STAR' and new.fecha_clase_prueba is null then
    new.fecha_clase_prueba := public.fn_proxima_clase_star_desde(now());
    new.dia_clase_prueba := 'SABADO';
    new.quiere_clase_prueba := true;
    if new.proxima_accion is null or new.proxima_accion = 'Contactar apoderado' then
      new.proxima_accion := 'Confirmar clase de prueba Firehouse Star';
    end if;
  elsif new.journey = 'FIREHOUSE_STAR' and new.fecha_clase_prueba is null then
    -- Primera clase de la inscripción: la que le correspondió al registrarse.
    new.fecha_clase_prueba := public.fn_proxima_clase_star_desde(coalesce(new.created_at, now()));
    new.dia_clase_prueba := 'SABADO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_fecha_clase_star on public.casos_crm;
create trigger trg_casos_fecha_clase_star
  before insert or update of journey on public.casos_crm
  for each row execute function public.fn_casos_fecha_clase_star();

-- 3. Inscripciones Star existentes -------------------------------------------------
alter table public.casos_crm disable trigger trg_casos_updated_at;

update public.casos_crm set
  fecha_clase_prueba = public.fn_proxima_clase_star_desde(created_at),
  dia_clase_prueba   = 'SABADO'
where journey = 'FIREHOUSE_STAR' and fecha_clase_prueba is null;

alter table public.casos_crm enable trigger trg_casos_updated_at;

insert into public.schema_migraciones (version, descripcion)
values ('0014', 'fecha de la primera clase Star guardada, editable y con corte por hora de inicio')
on conflict (version) do nothing;

commit;

-- Verificación: casos Star por fecha de primera clase (ninguno debe quedar sin fecha).
select journey, fecha_clase_prueba, count(*) as casos
from public.casos_crm
where journey in ('CLASE_PRUEBA_STAR', 'FIREHOUSE_STAR')
group by journey, fecha_clase_prueba
order by fecha_clase_prueba nulls first, journey;
