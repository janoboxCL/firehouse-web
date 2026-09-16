-- Plantilla manual de WhatsApp para invitar familias desde el CRM.
-- No se usa para el correo automático de confirmación de pago: ese correo se
-- construye y envía por Resend desde functions/lib/star-confirmation.ts.
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
