-- ============================================================================
-- 0009 — Firma de los mensajes y plantillas de clase de prueba
-- ============================================================================
-- Qué hace (aditivo, idempotente y transaccional):
--   1. admin_profiles: nombre_firma (cómo se presenta cada usuario en los
--      mensajes) y cargo ('Head Coach' o 'Asistente', por defecto Asistente).
--      Cada usuario puede editar su nombre_firma, pero no su cargo, rol ni
--      estado: eso solo se cambia desde el SQL Editor.
--   2. atletas.talla_polera.
--   3. plantillas_mensaje: categoría ('GENERAL' o 'CLASE_PRUEBA') y orden.
--   4. interacciones.plantilla_id: qué plantilla se envió a cada familia.
--   5. Las cuatro plantillas de WhatsApp de la secuencia de clase de prueba.
-- ============================================================================

begin;

-- 1. Firma ------------------------------------------------------------------
alter table public.admin_profiles add column if not exists nombre_firma varchar(60);
alter table public.admin_profiles add column if not exists cargo varchar(40) not null default 'Asistente';
alter table public.admin_profiles drop constraint if exists admin_profiles_cargo_check;
alter table public.admin_profiles add constraint admin_profiles_cargo_check check (cargo in ('Head Coach', 'Asistente'));

-- La política admin_update_own_profile permite a cada usuario editar su fila.
-- Este trigger impide que alguien cambie desde el panel su propio cargo, rol o
-- estado. Desde el SQL Editor (sin sesión de usuario) sí se puede.
create or replace function public.admin_profiles_proteger()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and (
       new.cargo is distinct from old.cargo
    or new.role is distinct from old.role
    or new.active is distinct from old.active
    or new.user_id is distinct from old.user_id) then
    raise exception 'solo_nombre_firma_editable';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_profiles_proteger on public.admin_profiles;
create trigger admin_profiles_proteger
  before update on public.admin_profiles
  for each row execute function public.admin_profiles_proteger();

update public.admin_profiles set cargo = 'Head Coach'
where display_name ilike 'benjam%' and cargo <> 'Head Coach';

-- 2. Talla de polera -------------------------------------------------------------
alter table public.atletas add column if not exists talla_polera varchar(10);
alter table public.atletas drop constraint if exists atletas_talla_polera_check;
alter table public.atletas add constraint atletas_talla_polera_check
  check (talla_polera is null or char_length(talla_polera) between 1 and 10);

-- 3. Categoría de plantillas ----------------------------------------------------
alter table public.plantillas_mensaje add column if not exists categoria varchar(20) not null default 'GENERAL';
alter table public.plantillas_mensaje add column if not exists orden smallint not null default 0;
alter table public.plantillas_mensaje drop constraint if exists plantillas_mensaje_categoria_check;
alter table public.plantillas_mensaje add constraint plantillas_mensaje_categoria_check
  check (categoria in ('GENERAL', 'CLASE_PRUEBA'));

-- 4. Plantilla enviada en cada interacción ------------------------------------
alter table public.interacciones add column if not exists plantilla_id uuid
  references public.plantillas_mensaje(id) on delete set null;
create index if not exists idx_interacciones_plantilla on public.interacciones (plantilla_id) where plantilla_id is not null;

-- 5. Secuencia de clase de prueba (editables en /admin/plantillas) ------------
insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, activo, categoria, orden)
select v.nombre, 'WHATSAPP', null, v.cuerpo, true, 'CLASE_PRUEBA', v.orden
from (values
  (1, '1 · Bienvenida y talla',
   E'¡Hola, {nombre_apoderado}! 👋 Soy {remitente}, {cargo} de Firehouse Star ⭐\n\nTe esperamos {fecha_clase} a las {hora_clase} con {nombre_atleta} en su primera clase. Estamos preparando una bienvenida especial: globos, stickers y su primer salto de cheer 🎉\n\nPara tener todo listo, ¿qué talla de polera usa {nombre_atleta}?'),
  (2, '2 · Llega con su polera',
   E'¡Gracias, {nombre_apoderado}! Anotamos la talla {talla} de {nombre_atleta} 🙌\n\nSi quieres que llegue a su primera clase con su polera de entrenamiento y su scrunchie, puedes inscribirla antes aquí:\n{link_pago}\n\nLa inscripción ({valor_inscripcion}) incluye el Kit de Iniciación. Si prefieres esperar a que pruebe la clase, no hay ningún problema: puedes inscribirla después.\n\n¡Nos vemos {fecha_clase}! {remitente}, {cargo} de Firehouse Star'),
  (3, '2b · Sin respuesta',
   E'¡Hola, {nombre_apoderado}! Soy {remitente}, {cargo} de Firehouse Star ⭐\n\nTe escribo para confirmar la primera clase de {nombre_atleta} {fecha_clase} a las {hora_clase}. Para tener su polera lista, ¿qué talla usa?'),
  (4, '3 · Nos vemos mañana',
   E'¡Mañana es el gran día, {nombre_apoderado}! 🎉\n\nTe esperamos con {nombre_atleta} a las {hora_clase} en Santa Corina 197, La Cisterna, cerca del Metro Lo Ovalle:\nhttps://maps.google.com/?q=Santa+Corina+197,+La+Cisterna\n\nQue venga con ropa cómoda, zapatillas, el pelo tomado y una botella de agua.\n\n¡Nos vemos! {remitente}, {cargo} de Firehouse Star')
) as v(orden, nombre, cuerpo)
where not exists (
  select 1 from public.plantillas_mensaje p where p.categoria = 'CLASE_PRUEBA' and p.nombre = v.nombre
);

do $$
begin
  if to_regclass('public.schema_migraciones') is not null then
    insert into public.schema_migraciones (version, descripcion)
    values ('0009', 'firma de mensajes, talla de polera y plantillas de clase de prueba')
    on conflict (version) do nothing;
  end if;
end $$;

commit;

-- Verificación: Benjamín debe aparecer como Head Coach y el resto como Asistente.
-- Si no, corrige con:
--   update admin_profiles set cargo = 'Head Coach' where display_name = '<nombre>';
select display_name, cargo, nombre_firma from public.admin_profiles order by cargo, display_name;
