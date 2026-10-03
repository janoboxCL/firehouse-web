-- ============================================================================
-- 0019 — Confirmación de datos en el link de pago
-- ============================================================================
-- Antes de pagar, la familia revisa y completa sus datos en su link personal
-- (/pagar?t=…): datos del apoderado y de cada deportista, ya prellenados.
-- Sirve sobre todo para los registros express, que solo tienen nombre, edad y
-- WhatsApp.
--
-- Qué hace (aditiva, idempotente y transaccional):
--   1. apoderados.ficha_confirmada_at: cuándo la familia confirmó sus datos.
--   2. fn_confirmar_ficha_familia: guarda los datos confirmados de una sola
--      vez. Solo la llama el servidor (clave de servicio), que antes valida
--      el link y los datos.
--   3. Plantilla «6 · Inscripción después de la clase», con el link de pago.
--
-- Requiere 0017.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'apoderados' and column_name = 'datos_pendientes') then
    raise exception 'Falta la migración 0017.';
  end if;
end $$;

-- 1. Marca de ficha confirmada ---------------------------------------------------
alter table public.apoderados add column if not exists ficha_confirmada_at timestamptz;

-- 2. Guardar la ficha confirmada -------------------------------------------------
-- payload:
--   { "apoderado": { "nombre", "apellidos", "telefono", "email", "comuna", "relacion" },
--     "atletas": [ { "id", "nombre", "apellidos", "fechaNacimiento", "talla" } ] }
create or replace function public.fn_confirmar_ficha_familia(p_apoderado_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ap     jsonb := payload->'apoderado';
  v_atleta jsonb;
  v_n      integer := 0;
  v_caso   uuid;
begin
  update apoderados set
    nombre    = btrim(v_ap->>'nombre'),
    apellidos = btrim(v_ap->>'apellidos'),
    telefono  = v_ap->>'telefono',
    email     = lower(btrim(v_ap->>'email')),
    comuna    = btrim(v_ap->>'comuna'),
    relacion  = v_ap->>'relacion',
    datos_pendientes = false,
    ficha_confirmada_at = now(),
    -- Quien solo había autorizado de palabra en recepción acepta ahora la política publicada.
    privacy_policy_version = case when privacy_policy_version is null or privacy_policy_version = 'verbal-recepcion'
                                  then '2026-09' else privacy_policy_version end
  where id = p_apoderado_id;
  if not found then
    raise exception 'apoderado_no_existe';
  end if;

  for v_atleta in select * from jsonb_array_elements(coalesce(payload->'atletas', '[]'::jsonb))
  loop
    update atletas set
      nombre           = btrim(v_atleta->>'nombre'),
      apellidos        = btrim(v_atleta->>'apellidos'),
      fecha_nacimiento = (v_atleta->>'fechaNacimiento')::date,
      talla_polera     = coalesce(nullif(btrim(coalesce(v_atleta->>'talla', '')), ''), talla_polera),
      fecha_nacimiento_estimada = false
    where id = (v_atleta->>'id')::uuid and apoderado_id = p_apoderado_id;
    if not found then
      raise exception 'atleta_no_es_de_la_familia';
    end if;
    v_n := v_n + 1;

    select id into v_caso from casos_crm where atleta_id = (v_atleta->>'id')::uuid order by created_at desc limit 1;
    if v_caso is not null then
      insert into interacciones (caso_id, tipo, nota, fecha)
      values (v_caso, 'NOTA', 'La familia confirmó sus datos desde el link de pago.', now());
      update casos_crm set proxima_accion = null, fecha_proxima_accion = null
       where id = v_caso and proxima_accion = 'Completar datos de la familia';
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'atletas', v_n);
end;
$$;

revoke all on function public.fn_confirmar_ficha_familia(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_confirmar_ficha_familia(uuid, jsonb) to service_role;

-- 3. Plantilla para invitar a inscribirse después de la clase ---------------------
insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, cuerpo_email, activo, categoria, orden)
select '6 · Inscripción después de la clase', 'AMBOS',
  'Inscripción de {nombre_atleta} en Firehouse Star ⭐',
  E'¡Hola, {nombre_apoderado}! Te escribe {remitente}, {cargo} de Firehouse Star ⭐\n\n¡Qué alegría haber recibido a {nombre_atleta} en la clase! Esperamos que lo haya pasado muy bien 🔥\n\nSi quieren seguir con nosotros, la inscripción se hace en este link personal:\n{link_pago}\n\nSon dos pasos:\n1️⃣ Confirmar tus datos y los de {nombre_atleta} (ya vienen prellenados)\n2️⃣ Pagar la inscripción ({valor_inscripcion}), que incluye el Kit de Iniciación: polera de entrenamiento y scrunchie\n\nEl link es solo para tu familia. Cualquier duda, respóndeme por aquí.',
  E'Hola, {nombre_apoderado}:\n\n¡Qué alegría haber recibido a {nombre_atleta} en la clase de Firehouse Star! Esperamos que lo haya pasado muy bien.\n\nSi quieren seguir con nosotros, la inscripción se hace en tu link personal. Son dos pasos:\n- Confirmar tus datos y los de {nombre_atleta} (ya vienen prellenados)\n- Pagar la inscripción ({valor_inscripcion}), que incluye el Kit de Iniciación: polera de entrenamiento y scrunchie\n\n[[boton: Completar la inscripción | {link_pago}]]\n\nEl link es solo para tu familia. Cualquier duda, responde este correo o escríbenos por WhatsApp.\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star',
  true, 'CLASE_PRUEBA', 6
where to_regclass('public.plantillas_mensaje') is not null
  and not exists (select 1 from public.plantillas_mensaje p where p.categoria = 'CLASE_PRUEBA' and p.nombre = '6 · Inscripción después de la clase');

insert into public.schema_migraciones (version, descripcion)
values ('0019', 'confirmación de datos de la familia en el link de pago y plantilla de inscripción')
on conflict (version) do nothing;

commit;

-- Verificación: familias que aún no confirman sus datos.
select count(*) filter (where ficha_confirmada_at is null) as sin_confirmar, count(*) as familias from public.apoderados;
