-- ============================================================================
-- 0012 — Configuración de la academia y mensajes Firehouse Star
-- ============================================================================
-- Qué hace (aditiva, idempotente y transaccional):
--   1. configuracion_academia: valores que estaban fijos en el código y ahora
--      se editan en /admin/configuracion:
--        - horario Firehouse Star (primera clase, hora de inicio y término);
--        - día de vencimiento de la mensualidad y prorrateo por semana;
--        - tallas de polera.
--   2. configuracion_clase_prueba: disciplina y horario de cada día.
--   3. fn_proxima_clase_star() lee la primera clase desde la configuración.
--   4. admin_profiles.cargo admite también "Coach".
--   5. plantillas_mensaje.cuerpo_email: versión correo de cada plantilla.
--   6. Secuencia de mensajes de clase de prueba Star, en WhatsApp y correo:
--        1 · Recordatorio primera clase   (reemplaza "1 · Bienvenida y talla")
--        2 · Inscripción y polera         (reemplaza "2 · Llega con su polera")
--        3 · Mañana es tu clase           (reemplaza "3 · Nos vemos mañana")
--      "2b · Sin respuesta" queda desactivada (no se borra).
--      Solo se reemplazan si conservan su nombre original de la 0009.
--
-- Los valores iniciales son los que el sistema usa hoy, así que nada cambia
-- hasta que se editen en el panel. Requiere 0009 y 0010.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'plantillas_mensaje' and column_name = 'categoria') then
    raise exception 'Falta la migración 0009.';
  end if;
  if to_regprocedure('public.fn_proxima_clase_star(date)') is null then
    raise exception 'Falta la migración 0010.';
  end if;
end $$;

-- 1. Configuración de la academia --------------------------------------------
create table if not exists public.configuracion_academia (
  id                    smallint primary key default 1 check (id = 1),
  star_primera_clase    date not null default date '2026-10-03',
  star_hora_inicio      time not null default time '18:30',
  star_hora_fin         time not null default time '20:00',
  cobro_dia_vencimiento smallint not null default 5 check (cobro_dia_vencimiento between 1 and 28),
  cobro_prorrateo       smallint[] not null default '{100,75,50,25}',
  tallas_polera         text[] not null default '{4,6,8,10,12,14,16,XS,S,M,L,XL}',
  updated_at            timestamptz not null default now(),
  check (star_hora_fin > star_hora_inicio),
  check (array_length(cobro_prorrateo, 1) = 4 and 0 <= all (cobro_prorrateo) and 100 >= all (cobro_prorrateo)),
  check (array_length(tallas_polera, 1) between 1 and 30)
);

insert into public.configuracion_academia (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_configuracion_academia_updated_at on public.configuracion_academia;
create trigger trg_configuracion_academia_updated_at before update on public.configuracion_academia
  for each row execute function set_updated_at();

alter table public.configuracion_academia enable row level security;
drop policy if exists admin_select_configuracion_academia on public.configuracion_academia;
create policy admin_select_configuracion_academia on public.configuracion_academia
  for select to authenticated using (is_admin());
drop policy if exists admin_update_configuracion_academia on public.configuracion_academia;
create policy admin_update_configuracion_academia on public.configuracion_academia
  for update to authenticated using (is_admin()) with check (is_admin());

-- 2. Horario de cada día de clase de prueba ---------------------------------
alter table public.configuracion_clase_prueba add column if not exists disciplina varchar(40);
alter table public.configuracion_clase_prueba add column if not exists hora_inicio time;
alter table public.configuracion_clase_prueba add column if not exists hora_fin time;

-- Si faltara alguna fila, se crea habilitada (así el panel siempre puede guardarla).
insert into public.configuracion_clase_prueba (dia, habilitado) values ('VIERNES', true), ('SABADO', true)
on conflict (dia) do nothing;

update public.configuracion_clase_prueba set disciplina = 'Cheer', hora_inicio = time '18:00', hora_fin = time '20:00'
where dia = 'VIERNES' and hora_inicio is null;
update public.configuracion_clase_prueba set disciplina = 'Gimnasia', hora_inicio = time '16:00', hora_fin = time '18:00'
where dia = 'SABADO' and hora_inicio is null;

alter table public.configuracion_clase_prueba drop constraint if exists configuracion_clase_prueba_horario_check;
alter table public.configuracion_clase_prueba add constraint configuracion_clase_prueba_horario_check
  check (hora_inicio is null or hora_fin is null or hora_fin > hora_inicio);

-- 3. Próxima clase Star según la configuración ------------------------------
create or replace function public.fn_proxima_clase_star(p_desde date)
returns date
language sql
stable
security definer  -- lee solo la fecha configurada, aunque quien inserte no vea la tabla (RLS)
set search_path = public
as $$
  select case
    when p_desde <= c.star_primera_clase then c.star_primera_clase
    else c.star_primera_clase + (7 * ceil((p_desde - c.star_primera_clase) / 7.0))::integer
  end
  from public.configuracion_academia c
  where c.id = 1;
$$;

revoke all on function public.fn_proxima_clase_star(date) from public;
grant execute on function public.fn_proxima_clase_star(date) to anon, authenticated, service_role;

-- 4. Cargos ------------------------------------------------------------------------
alter table public.admin_profiles drop constraint if exists admin_profiles_cargo_check;
alter table public.admin_profiles add constraint admin_profiles_cargo_check
  check (cargo in ('Head Coach', 'Coach', 'Asistente'));

-- 5. Versión correo de las plantillas ---------------------------------------
alter table public.plantillas_mensaje add column if not exists cuerpo_email text;

-- 6. Secuencia de mensajes de clase de prueba Star ------------------------------
create temporary table tmp_plantillas_star (
  orden        smallint,
  nombre_viejo text,
  nombre       text,
  asunto       text,
  cuerpo       text,
  cuerpo_email text
) on commit drop;

insert into tmp_plantillas_star values
(1, '1 · Bienvenida y talla', '1 · Recordatorio primera clase',
 '{nombre_atleta} tiene su primera clase en Firehouse Star ⭐',
 E'¡Hola, {nombre_apoderado}! 👋 Soy {remitente}, {cargo} de Firehouse Star ⭐\n\nTe recordamos que {fecha_clase} a las {hora_clase} es la primera clase de {nombre_atleta} en Firehouse Star. ¡No falten, los esperamos!\n\nEstamos preparando una bienvenida especial: globos, stickers y su primer salto de cheer 🎉\n\nPara tener todo listo, ¿qué talla de polera usa {nombre_atleta}?',
 E'Hola, {nombre_apoderado}:\n\nTe recordamos que {fecha_clase} a las {hora_clase} es la primera clase de {nombre_atleta} en Firehouse Star. ¡No falten, los esperamos!\n\nEstamos preparando una bienvenida especial: globos, stickers y su primer salto de cheer.\n\n[[clase]]\n\nPara tener todo listo, ¿qué talla de polera usa {nombre_atleta}? Puedes responder este correo o escribirnos por WhatsApp.\n\n[[boton: Responder por WhatsApp | https://wa.me/56986114663]]\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star'),
(2, '2 · Llega con su polera', '2 · Inscripción y polera',
 'Que {nombre_atleta} llegue a su primera clase con su polera ⭐',
 E'¡Hola, {nombre_apoderado}! ⭐\n\nSi quieres que {nombre_atleta} llegue a su primera clase con su polera de entrenamiento y su scrunchie, puedes hacer la inscripción desde ahora:\n{link_pago}\n\nLa inscripción ({valor_inscripcion}) incluye el Kit de Iniciación Firehouse Star. Si prefieres esperar a que pruebe la clase, no hay ningún problema: también puedes hacer la inscripción después.\n\nSi aún no nos cuentas su talla de polera, respóndenos con ella.\n\n¡Nos vemos {fecha_clase}! {remitente}, {cargo} de Firehouse Star',
 E'Hola, {nombre_apoderado}:\n\n¿Quieres que {nombre_atleta} llegue a su primera clase de Firehouse Star con su polera de entrenamiento y su scrunchie? Puedes hacer la inscripción desde ahora.\n\nLa inscripción ({valor_inscripcion}) incluye el Kit de Iniciación Firehouse Star:\n- Polera de entrenamiento Firehouse Star\n- Scrunchie Firehouse\n\n[[boton: Inscribir a {nombre_atleta} | {link_pago}]]\n\nSi prefieres esperar a que pruebe la clase, no hay ningún problema: también puedes hacer la inscripción después. Si aún no nos cuentas su talla de polera, respóndenos este correo con ella.\n\n[[clase]]\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star'),
(3, '3 · Nos vemos mañana', '3 · Mañana es tu clase',
 'Mañana es la primera clase de {nombre_atleta} 🎉',
 E'¡Mañana es el gran día, {nombre_apoderado}! 🎉\n\nTe esperamos con {nombre_atleta} {fecha_clase} a las {hora_clase} en Santa Corina 197, La Cisterna, cerca del Metro Lo Ovalle:\nhttps://maps.google.com/?q=Santa+Corina+197,+La+Cisterna\n\nQue venga con ropa cómoda, zapatillas, el pelo tomado y una botella de agua. Te recomendamos llegar 10 minutos antes.\n\n¡No se la pierdan! {remitente}, {cargo} de Firehouse Star',
 E'¡Mañana es el gran día, {nombre_apoderado}! 🎉\n\nTe esperamos con {nombre_atleta} en su primera clase de Firehouse Star.\n\n[[clase]]\n\nPara mañana:\n- Ropa cómoda y zapatillas\n- Pelo tomado\n- Una botella de agua\n- Llegar 10 minutos antes\n\n[[boton: Cómo llegar | https://maps.google.com/?q=Santa+Corina+197,+La+Cisterna]]\n\n¡No se la pierdan!\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star');

-- Reemplaza las plantillas de la 0009 que conservan su nombre original.
update public.plantillas_mensaje p set
  nombre = t.nombre, asunto = t.asunto, cuerpo = t.cuerpo, cuerpo_email = t.cuerpo_email,
  canal = 'AMBOS', orden = t.orden, activo = true
from tmp_plantillas_star t
where p.categoria = 'CLASE_PRUEBA' and p.nombre = t.nombre_viejo;

-- Crea las que falten (por ejemplo, si alguna se había renombrado).
insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, cuerpo_email, activo, categoria, orden)
select t.nombre, 'AMBOS', t.asunto, t.cuerpo, t.cuerpo_email, true, 'CLASE_PRUEBA', t.orden
from tmp_plantillas_star t
where not exists (select 1 from public.plantillas_mensaje p where p.categoria = 'CLASE_PRUEBA' and p.nombre = t.nombre);

update public.plantillas_mensaje set activo = false
where categoria = 'CLASE_PRUEBA' and nombre = '2b · Sin respuesta';

insert into public.schema_migraciones (version, descripcion)
values ('0012', 'configuración de la academia y mensajes Firehouse Star en WhatsApp y correo')
on conflict (version) do nothing;

commit;

-- Verificación: la configuración y las plantillas activas de clase de prueba.
select star_primera_clase, star_hora_inicio, star_hora_fin, cobro_dia_vencimiento, cobro_prorrateo
from public.configuracion_academia;
select orden, nombre, canal, (cuerpo_email is not null) as tiene_correo
from public.plantillas_mensaje where categoria = 'CLASE_PRUEBA' and activo order by orden;
