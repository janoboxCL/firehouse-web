-- Evita duplicar el correo cuando el pago es confirmado primero por el retorno
-- del checkout y luego por el webhook (o viceversa).
alter table public.star_ordenes
  add column if not exists correo_confirmacion_enviado_at timestamptz;
