-- ============================================================================
-- 0008 — Funciones de servidor: solo ejecutables con la clave de servicio
-- ============================================================================
-- Supabase otorga por defecto permiso de ejecución a anon y authenticated sobre
-- toda función del esquema public. Varias funciones SECURITY DEFINER que solo
-- deben llamar los webhooks y endpoints del servidor quedaban, por lo tanto,
-- ejecutables con la clave pública del sitio. Por ejemplo, fn_confirmar_pago_star
-- permitía marcar como pagada una orden Star sin pasar por la pasarela.
--
-- Todas las llamadas del código a estas funciones se hacen desde Cloudflare
-- Functions con la clave de servicio (verificado el 23/9/2026), así que retirar
-- el permiso a anon y authenticated no afecta el funcionamiento.
--
-- No se tocan las funciones que el panel llama con la sesión del admin
-- (fn_fusionar_apoderados, fn_registrar_visita_rapida, is_admin).
-- fn_generar_codigos_faltantes_rifa se deja solo para authenticated.
--
-- Idempotente y transaccional.
-- ============================================================================

begin;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fn_confirmar_pago_star', 'fn_marcar_pago_no_aprobado_star', 'fn_marcar_pago_reembolsado_star',
        'fn_crear_registro', 'fn_crear_registro_star',
        'fn_confirmar_pago_rifa', 'fn_reservar_numeros_rifa', 'fn_liberar_reservas_vencidas_rifa',
        'fn_marcar_venta_no_pagada_rifa', 'fn_sembrar_numeros_rifa', 'fn_generar_codigo_unico_rifa'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;

  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_generar_codigos_faltantes_rifa'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated, service_role', f.firma);
  end loop;
end $$;

do $$
begin
  if to_regclass('public.schema_migraciones') is not null then
    insert into public.schema_migraciones (version, descripcion)
    values ('0008', 'permisos: funciones de servidor solo con clave de servicio')
    on conflict (version) do nothing;
  end if;
end $$;

commit;

-- Verificación: debe devolver una fila por función con anon_puede = false.
select p.proname as funcion,
       has_function_privilege('anon', p.oid, 'execute') as anon_puede,
       has_function_privilege('service_role', p.oid, 'execute') as servidor_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fn_confirmar_pago_star', 'fn_confirmar_pago_rifa', 'fn_crear_registro', 'fn_crear_registro_star',
                    'fn_confirmar_pago_campana', 'fn_registrar_entrada_gratis_campana')
order by 1;
