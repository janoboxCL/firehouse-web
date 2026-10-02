-- ============================================================================
-- 0017 — Registro express en Recepción
-- ============================================================================
-- Para quien llega a la clase sin haberse inscrito en la página. En la puerta
-- se piden solo: nombre de la niña o niño, edad, talla de polera, nombre de
-- pila del apoderado y su WhatsApp. El resto (apellidos, fecha de nacimiento
-- exacta, correo, comuna) queda "por completar".
--
-- Qué hace (aditiva, idempotente y transaccional):
--   1. apoderados.datos_pendientes y atletas.fecha_nacimiento_estimada:
--      marcan lo que falta confirmar (los usará el paso "Completa tu ficha").
--   2. fn_registro_express(payload): crea o reutiliza la familia, crea cada
--      deportista con su caso de clase de prueba ya en estado ASISTIO (la
--      migración 0016 registra la asistencia de esa fecha automáticamente).
--      Solo admin activos. Si el WhatsApp ya existe, NO crea nada y devuelve
--      las familias coincidentes para que el panel pregunte qué hacer.
--
-- Datos provisorios que guarda: apellidos, correo y comuna vacíos; fecha de
-- nacimiento estimada a partir de la edad (edad cumplida hace 6 meses, para
-- que la edad mostrada sea la declarada); cómo nos conocieron = OTRO.
--
-- Requiere 0016.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.asistencias') is null then
    raise exception 'Falta la migración 0016.';
  end if;
end $$;

-- 1. Marcas de datos por completar ----------------------------------------------
alter table public.apoderados add column if not exists datos_pendientes boolean not null default false;
alter table public.atletas add column if not exists fecha_nacimiento_estimada boolean not null default false;

-- 2. Registro express ---------------------------------------------------------------
-- payload:
--   { "fecha": "2026-10-03",
--     "apoderadoId": "<uuid>" | null,      -- agregar a una familia existente
--     "forzarNuevo": true | false,         -- crear aunque el WhatsApp ya exista
--     "apoderado": { "nombre": "Carolina", "telefono": "+56912345678", "relacion": "MAMA" },
--     "atletas": [ { "nombre": "Sofía", "edad": 7, "talla": "8" } ] }
create or replace function public.fn_registro_express(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha        date := (payload->>'fecha')::date;
  v_ap           jsonb := payload->'apoderado';
  v_nombre       text := btrim(coalesce(v_ap->>'nombre', ''));
  v_telefono     text := coalesce(v_ap->>'telefono', '');
  v_relacion     text := coalesce(nullif(v_ap->>'relacion', ''), 'OTRO');
  v_apoderado_id uuid := nullif(payload->>'apoderadoId', '')::uuid;
  v_forzar       boolean := coalesce((payload->>'forzarNuevo')::boolean, false);
  v_existentes   jsonb;
  v_dup          boolean := false;
  v_atleta       jsonb;
  v_atleta_id    uuid;
  v_caso_id      uuid;
  v_edad         integer;
  v_talla        text;
  v_dia          text;
  v_resultado    jsonb := '[]'::jsonb;
  v_n            integer := coalesce(jsonb_array_length(payload->'atletas'), 0);
begin
  if not is_admin() then
    raise exception 'solo_admin';
  end if;
  if v_fecha is null then
    raise exception 'fecha_requerida';
  end if;
  if v_n < 1 or v_n > 6 then
    raise exception 'atletas_invalidos';
  end if;

  if v_apoderado_id is not null then
    if not exists (select 1 from apoderados where id = v_apoderado_id) then
      raise exception 'apoderado_no_existe';
    end if;
  else
    if v_nombre = '' or char_length(v_nombre) > 80 then
      raise exception 'nombre_apoderado_invalido';
    end if;
    if v_telefono !~ '^\+569[0-9]{8}$' then
      raise exception 'telefono_invalido';
    end if;
    if v_relacion not in ('MAMA', 'PAPA', 'TUTOR', 'OTRO') then
      raise exception 'relacion_invalida';
    end if;

    -- ¿Ya existe una familia con ese WhatsApp? Se pregunta antes de crear otra.
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'nombre', btrim(a.nombre || ' ' || a.apellidos),
             'atletas', coalesce((select jsonb_agg(t.nombre order by t.nombre) from atletas t where t.apoderado_id = a.id), '[]'::jsonb)
           ) order by a.created_at)
      into v_existentes
      from apoderados a
     where a.telefono = v_telefono;

    if v_existentes is not null and not v_forzar then
      return jsonb_build_object('duplicado', true, 'existentes', v_existentes);
    end if;
    v_dup := v_existentes is not null;

    insert into apoderados (
      nombre, apellidos, telefono, email, relacion, comuna, canal_preferido,
      consent_contact, consent_at, privacy_policy_version,
      possible_duplicate, duplicate_reason, datos_pendientes
    ) values (
      v_nombre, '', v_telefono, '', v_relacion, '', 'WHATSAPP',
      true, now(), 'verbal-recepcion',
      v_dup, case when v_dup then 'PHONE_MATCH' end, true
    ) returning id into v_apoderado_id;
  end if;

  v_dia := case extract(dow from v_fecha) when 5 then 'VIERNES' when 6 then 'SABADO' end;

  for v_atleta in select * from jsonb_array_elements(payload->'atletas')
  loop
    v_edad := (v_atleta->>'edad')::integer;
    v_talla := nullif(btrim(coalesce(v_atleta->>'talla', '')), '');
    if btrim(coalesce(v_atleta->>'nombre', '')) = '' or char_length(v_atleta->>'nombre') > 80 then
      raise exception 'nombre_atleta_invalido';
    end if;
    if v_edad is null or v_edad < 2 or v_edad > 25 then
      raise exception 'edad_invalida';
    end if;
    if v_talla is not null and char_length(v_talla) > 10 then
      raise exception 'talla_invalida';
    end if;

    insert into atletas (
      apoderado_id, nombre, apellidos, fecha_nacimiento, firehouse_actual,
      fuera_rango_habitual, talla_polera, fecha_nacimiento_estimada
    ) values (
      v_apoderado_id, btrim(v_atleta->>'nombre'), '',
      (v_fecha - make_interval(years => v_edad, months => 6))::date,
      false, false, v_talla, true
    ) returning id into v_atleta_id;

    -- Se crea ya en ASISTIO: el trigger de la 0016 registra la asistencia de v_fecha.
    insert into casos_crm (
      atleta_id, journey, estado, origen, como_conocio, comentario_inicial,
      proxima_accion, fecha_proxima_accion, prioridad,
      quiere_clase_prueba, dia_clase_prueba, fecha_clase_prueba
    ) values (
      v_atleta_id, 'CLASE_PRUEBA_STAR', 'ASISTIO', 'RECEPCION', 'OTRO', null,
      'Completar datos de la familia', now(), 'NORMAL',
      true, v_dia, v_fecha
    ) returning id into v_caso_id;

    insert into interacciones (caso_id, tipo, nota, responsable_id, fecha)
    values (v_caso_id, 'NOTA', 'Registro express en recepción. Datos por completar: apellidos, fecha de nacimiento, correo y comuna.', auth.uid(), now());

    v_resultado := v_resultado || jsonb_build_object('atletaId', v_atleta_id, 'casoId', v_caso_id, 'nombre', btrim(v_atleta->>'nombre'));
  end loop;

  return jsonb_build_object('duplicado', false, 'apoderadoId', v_apoderado_id, 'atletas', v_resultado);
end;
$$;

revoke all on function public.fn_registro_express(jsonb) from public, anon;
grant execute on function public.fn_registro_express(jsonb) to authenticated;

insert into public.schema_migraciones (version, descripcion)
values ('0017', 'registro express en recepción y marcas de datos por completar')
on conflict (version) do nothing;

commit;

-- Verificación: familias con datos por completar.
select count(*) as familias_por_completar from public.apoderados where datos_pendientes;
