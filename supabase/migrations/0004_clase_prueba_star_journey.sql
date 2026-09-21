-- Conserva los journeys históricos y habilita el journey independiente de la
-- clase de prueba Star para nuevos registros.
alter table public.casos_crm drop constraint if exists casos_crm_journey_check;
alter table public.casos_crm add constraint casos_crm_journey_check check (journey in (
  'RENOVACION_2027', 'PRETEMPORADA', 'EXPERIMENTADA_2027',
  'PRINCIPIANTE_2027', 'CLASE_PRUEBA', 'CLASE_PRUEBA_STAR',
  'FIREHOUSE_STAR', 'POR_CLASIFICAR'
));
