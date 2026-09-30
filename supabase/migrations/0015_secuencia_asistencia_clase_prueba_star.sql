-- ============================================================================
-- 0015 — Secuencia para asegurar la asistencia a la clase de prueba Star
-- ============================================================================
-- Qué hace (aditiva, idempotente y transaccional):
--   Agrega cuatro plantillas de clase de prueba, editables en /admin/plantillas:
--     2 · Cómo llegar             (correo del jueves; también sirve por WhatsApp)
--     3 · Confirma tu asistencia  (WhatsApp del viernes, pide responder SÍ)
--     4 · Hoy es tu clase         (WhatsApp del sábado cerca de las 16:00,
--                                  solo a quienes confirmaron)
--     5 · Te echamos de menos     (después de la clase, solo a quienes no
--                                  asistieron; ofrece otra fecha)
--
--   Desactiva (no borra) dos plantillas de la 0012, solo si conservan su
--   nombre original:
--     "2 · Inscripción y polera" → se descarta el link de pago de poleras.
--     "3 · Mañana es tu clase"   → la reemplaza "3 · Confirma tu asistencia".
--   Ambas se pueden reactivar desde /admin/plantillas.
--
--   "1 · Recordatorio primera clase" no se modifica.
--
-- Requiere 0012 (columna cuerpo_email).
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'plantillas_mensaje' and column_name = 'cuerpo_email') then
    raise exception 'Falta la migración 0012.';
  end if;
end $$;

create temporary table tmp_plantillas_asistencia (
  orden        smallint,
  nombre       text,
  solo_whatsapp boolean,
  asunto       text,
  cuerpo       text,
  cuerpo_email text
) on commit drop;

insert into tmp_plantillas_asistencia values
(2, '2 · Cómo llegar', false,
 'Todo listo para la clase de prueba de {nombre_atleta} en Firehouse Star ⭐',
 E'¡Hola, {nombre_apoderado}! 👋 Soy {remitente}, {cargo} de Firehouse Star ⭐\n\nTe dejamos todo lo necesario para la clase de prueba de {nombre_atleta} {fecha_clase} a las {hora_clase}:\n\n📍 Santa Corina 197, La Cisterna, a pasos del Metro Lo Ovalle\nhttps://maps.google.com/?q=Santa+Corina+197,+La+Cisterna\n\n🕒 Te recomendamos llegar 15 minutos antes.\n🎒 Ropa deportiva cómoda, zapatillas, pelo tomado, sin joyas ni accesorios y una botella de agua.\n\nSi tienes algún imprevisto y no pueden asistir, avísanos por aquí y le reservamos otra fecha. ¡Los esperamos!',
 E'Hola, {nombre_apoderado}:\n\nTe esperamos con {nombre_atleta} en su clase de prueba de Firehouse Star. Te dejamos todo lo necesario para que lleguen sin complicaciones.\n\n[[clase]]\n\nTe recomendamos llegar 15 minutos antes, así {nombre_atleta} tendrá tiempo de ubicarse, conocer al equipo y comenzar puntualmente.\n\nQué traer:\n- Ropa deportiva cómoda y zapatillas\n- Pelo tomado, sin joyas ni accesorios\n- Una botella de agua\n\n[[boton: Cómo llegar | https://maps.google.com/?q=Santa+Corina+197,+La+Cisterna]]\n\nSi tienes algún imprevisto y no pueden asistir, avísanos respondiendo este correo o por WhatsApp, así le reservamos otra fecha.\n\n[[boton: Avisar por WhatsApp | https://wa.me/56986114663]]\n\n¡Nos vemos!\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star'),

(3, '3 · Confirma tu asistencia', false,
 'Mañana es la clase de prueba de {nombre_atleta}: ¿nos confirmas? 🎉',
 E'Hola, {nombre_apoderado}, te escribe {remitente}, {cargo} de Firehouse Star 👋\n\nMañana a las *{hora_clase}* es la clase de prueba de {nombre_atleta}. ¡Los esperamos con mucho entusiasmo!\n\n📍 Santa Corina 197, La Cisterna\nhttps://maps.google.com/?q=Santa+Corina+197,+La+Cisterna\n\nRecuerda venir con ropa deportiva, zapatillas, pelo tomado y agua.\n\n¿Nos confirmas su asistencia respondiendo *SÍ*? ¡Gracias!',
 E'Hola, {nombre_apoderado}:\n\nMañana es la clase de prueba de {nombre_atleta} en Firehouse Star. ¡Los esperamos con mucho entusiasmo!\n\n[[clase]]\n\nRecuerda venir con ropa deportiva, zapatillas, pelo tomado y una botella de agua. Te recomendamos llegar 15 minutos antes.\n\n¿Nos confirmas su asistencia? Basta con responder SÍ a este correo o escribirnos por WhatsApp.\n\n[[boton: Confirmar por WhatsApp | https://wa.me/56986114663]]\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star'),

(4, '4 · Hoy es tu clase', true,
 null,
 E'¡Hola, {nombre_apoderado}! Hoy los esperamos con {nombre_atleta} a las *{hora_clase}* en Santa Corina 197, La Cisterna 🙌\nhttps://maps.google.com/?q=Santa+Corina+197,+La+Cisterna\n\n¡Nos vemos en un rato! {remitente}, {cargo} de Firehouse Star',
 null),

(5, '5 · Te echamos de menos', false,
 'Reservemos otra clase de prueba para {nombre_atleta} ⭐',
 E'Hola, {nombre_apoderado}, te escribe {remitente}, {cargo} de Firehouse Star ⭐\n\nTe echamos de menos en la clase de prueba de {nombre_atleta}. Entendemos que a veces surgen imprevistos 😊\n\nSi te interesa, podemos reservarle un cupo para la próxima clase de prueba. ¿Te gustaría que te enviemos las fechas disponibles?',
 E'Hola, {nombre_apoderado}:\n\nTe echamos de menos en la clase de prueba de {nombre_atleta} en Firehouse Star. Entendemos que a veces surgen imprevistos.\n\nSi te interesa, podemos reservarle un cupo para la próxima clase de prueba. Responde este correo o escríbenos por WhatsApp y te enviamos las fechas disponibles.\n\n[[boton: Reservar otra fecha | https://wa.me/56986114663]]\n\nUn abrazo,\n{remitente}, {cargo} de Firehouse Star');

-- Crea las plantillas que no existan (no pisa ediciones hechas en el panel).
-- El canal va como literal, igual que en la 0012.
insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, cuerpo_email, activo, categoria, orden)
select t.nombre, 'AMBOS', t.asunto, t.cuerpo, t.cuerpo_email, true, 'CLASE_PRUEBA', t.orden
from tmp_plantillas_asistencia t
where not t.solo_whatsapp
  and not exists (select 1 from public.plantillas_mensaje p where p.categoria = 'CLASE_PRUEBA' and p.nombre = t.nombre);

insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, cuerpo_email, activo, categoria, orden)
select t.nombre, 'WHATSAPP', t.asunto, t.cuerpo, t.cuerpo_email, true, 'CLASE_PRUEBA', t.orden
from tmp_plantillas_asistencia t
where t.solo_whatsapp
  and not exists (select 1 from public.plantillas_mensaje p where p.categoria = 'CLASE_PRUEBA' and p.nombre = t.nombre);

-- Desactiva las plantillas reemplazadas (solo si conservan su nombre original).
update public.plantillas_mensaje set activo = false
where categoria = 'CLASE_PRUEBA'
  and nombre in ('2 · Inscripción y polera', '3 · Mañana es tu clase');

insert into public.schema_migraciones (version, descripcion)
values ('0015', 'secuencia de asistencia a la clase de prueba Star: cómo llegar, confirmación, día de la clase y seguimiento')
on conflict (version) do nothing;

commit;

-- Verificación: la secuencia activa debe ser 1, 2, 3, 4 y 5.
select orden, nombre, canal, activo, (cuerpo_email is not null) as tiene_correo
from public.plantillas_mensaje
where categoria = 'CLASE_PRUEBA'
order by activo desc, orden;
