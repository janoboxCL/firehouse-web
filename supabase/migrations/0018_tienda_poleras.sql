-- ============================================================================
-- 0018 — Tienda de poleras
-- ============================================================================
-- Venta de poleras por la página (/poleras) con pago por Mercado Pago. Sin
-- despacho: se entregan en el gimnasio. Se vende por encargo (sin stock).
--
-- Qué hace (aditiva, idempotente y transaccional):
--   1. tienda_productos: el producto, su precio, sus tallas y si está a la
--      venta. Parte DESACTIVADO y a $15.000: se activa en /admin/poleras.
--   2. tienda_pedidos y tienda_pedido_items: cada compra con sus tallas.
--      Los crea y confirma el servidor (clave de servicio); el panel solo
--      lee y marca "entregado".
--
-- Requiere 0001 (is_admin, admin_profiles, set_updated_at).
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.admin_profiles') is null then
    raise exception 'Falta la migración 0001.';
  end if;
end $$;

-- 1. Producto ---------------------------------------------------------------------
create table if not exists public.tienda_productos (
  codigo      text primary key,
  nombre      text not null,
  descripcion text not null default '',
  precio      integer not null default 0 check (precio >= 0 and precio <= 500000),
  tallas      text[] not null,
  activo      boolean not null default false,
  updated_at  timestamptz not null default now(),
  -- No se puede poner a la venta sin precio.
  check (not activo or precio > 0)
);

insert into public.tienda_productos (codigo, nombre, descripcion, precio, tallas, activo)
values ('POLERA', 'Polera Firehouse', '', 15000, array['10', '12', '14', 'S', 'M', 'L', 'XL'], false)
on conflict (codigo) do nothing;

-- 2. Pedidos ----------------------------------------------------------------------
create table if not exists public.tienda_pedidos (
  id                     uuid primary key default gen_random_uuid(),
  commerce_order         text not null unique,
  apoderado_nombre       text not null check (char_length(apoderado_nombre) between 2 and 80),
  alumno_nombre          text not null check (char_length(alumno_nombre) between 2 and 80),
  email                  text not null check (char_length(email) between 5 and 160),
  monto_total            integer not null check (monto_total > 0),
  estado                 text not null default 'PENDIENTE'
                         check (estado in ('PENDIENTE', 'PAGADO', 'RECHAZADO', 'ANULADO', 'REEMBOLSADO')),
  referencia_externa     text,
  pasarela_payment_id    text unique,
  metodo_pago            text,
  datos_json             jsonb,
  pagado_at              timestamptz,
  comprobante_enviado_at timestamptz,
  entregado_at           timestamptz,
  entregado_por          uuid references public.admin_profiles(user_id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists idx_tienda_pedidos_estado on public.tienda_pedidos (estado, created_at desc);

create table if not exists public.tienda_pedido_items (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.tienda_pedidos(id) on delete cascade,
  producto_codigo text not null references public.tienda_productos(codigo),
  talla           text not null,
  cantidad        integer not null check (cantidad between 1 and 20),
  precio_unitario integer not null check (precio_unitario > 0),
  unique (pedido_id, producto_codigo, talla)
);

-- 3. Permisos ---------------------------------------------------------------------
-- El público nunca toca estas tablas: compra a través de /api/tienda (clave de
-- servicio). El panel lee todo, edita el producto y marca la entrega.
alter table public.tienda_productos enable row level security;
alter table public.tienda_pedidos enable row level security;
alter table public.tienda_pedido_items enable row level security;

revoke all on public.tienda_productos, public.tienda_pedidos, public.tienda_pedido_items from public, anon, authenticated;
grant all on public.tienda_productos, public.tienda_pedidos, public.tienda_pedido_items to service_role;
grant select on public.tienda_productos, public.tienda_pedidos, public.tienda_pedido_items to authenticated;
grant update (nombre, descripcion, precio, tallas, activo, updated_at) on public.tienda_productos to authenticated;
grant update (entregado_at, entregado_por) on public.tienda_pedidos to authenticated;

drop policy if exists admin_select_tienda_productos on public.tienda_productos;
create policy admin_select_tienda_productos on public.tienda_productos
  for select to authenticated using (is_admin());
drop policy if exists admin_update_tienda_productos on public.tienda_productos;
create policy admin_update_tienda_productos on public.tienda_productos
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_select_tienda_pedidos on public.tienda_pedidos;
create policy admin_select_tienda_pedidos on public.tienda_pedidos
  for select to authenticated using (is_admin());
drop policy if exists admin_update_tienda_pedidos on public.tienda_pedidos;
create policy admin_update_tienda_pedidos on public.tienda_pedidos
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_select_tienda_items on public.tienda_pedido_items;
create policy admin_select_tienda_items on public.tienda_pedido_items
  for select to authenticated using (is_admin());

insert into public.schema_migraciones (version, descripcion)
values ('0018', 'tienda de poleras: producto, pedidos y entrega')
on conflict (version) do nothing;

commit;

-- Verificación: el producto existe y parte desactivado.
select codigo, nombre, precio, tallas, activo from public.tienda_productos;
