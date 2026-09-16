-- Evita duplicar el correo cuando el pago es confirmado primero por el retorno
-- del checkout y luego por el webhook (o viceversa).
alter table public.star_ordenes
  add column if not exists correo_confirmacion_enviado_at timestamptz;

-- Plantilla manual e independiente de cualquier journey/automatización. Una vez
-- aplicada la migración aparece en CRM > Plantillas y en las fichas de familias.
insert into public.plantillas_mensaje (nombre, canal, asunto, cuerpo, activo)
select
  'Invitación a conocer Firehouse Star',
  'WHATSAPP',
  null,
  E'¡Hola {nombre_apoderado}! 👋\n\nQueremos invitar a {nombre_atleta} a conocer *Firehouse Star* ⭐, nuestro programa para aprender cheerleading y gimnasia desde cero, en un ambiente entretenido, seguro y acompañado por nuestro equipo de coaches.\n\nConoce todos los detalles y reserva su cupo aquí: https://firehousecheer.cl/firehouse-star\n\n¡Nos encantaría recibirlos en Firehouse! 🔥',
  true
where not exists (
  select 1 from public.plantillas_mensaje
  where nombre = 'Invitación a conocer Firehouse Star'
);
