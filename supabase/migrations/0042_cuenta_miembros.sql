-- Cuentas POR ÁREA (pedido del user): el dueño crea cuentas para su equipo que
-- ven SOLO un pedazo de la plataforma — "solamente producción, solamente
-- estáticos" — igual que hoy existen las cuentas de editores (creators), pero
-- con acceso a secciones enteras del tablero del dueño.
--
-- Modelo:
--   - profiles.role = 'miembro' (nuevo): cuenta creada por un dueño.
--   - cuenta_miembros: a qué dueño pertenece y qué áreas ve/edita.
--     Áreas v1: 'metricas' | 'productos' | 'produccion' | 'landings'.
--   - RLS: policies ADITIVAS (permissive = OR con las existentes) que le dan a
--     un miembro acceso a las filas de SU dueño según el área. Sin fila en
--     cuenta_miembros, miembro_owner() devuelve null y nada matchea — las
--     cuentas existentes no cambian en nada.

create table if not exists public.cuenta_miembros (
  member_id    uuid primary key references auth.users(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  display_name text default '',
  areas        text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cuenta_miembros_owner_idx on public.cuenta_miembros(owner_id);

alter table public.cuenta_miembros enable row level security;
drop policy if exists cm_owner_all on public.cuenta_miembros;
create policy cm_owner_all on public.cuenta_miembros
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists cm_member_read on public.cuenta_miembros;
create policy cm_member_read on public.cuenta_miembros
  for select using (member_id = auth.uid());

-- ¿De qué dueño es miembro el caller (con esa área habilitada)? null = no es
-- miembro / no tiene el área. p_area null = cualquier membresía.
create or replace function public.miembro_owner(p_area text default null)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select owner_id from public.cuenta_miembros
  where member_id = auth.uid()
    and (p_area is null or p_area = any(areas))
  limit 1
$$;

-- ── Base: TODO miembro lee los productos de su dueño (son el esqueleto de
--    todas las áreas: nombres, cuentas de Meta, break-even…). ────────────────
drop policy if exists mk_productos_miembro_sel on public.marketing_productos;
create policy mk_productos_miembro_sel on public.marketing_productos
  for select using (user_id = public.miembro_owner(null));

-- ── Área 'productos' (workspace de productos: estáticos + inspiración) ──────
drop policy if exists mk_productos_miembro_all on public.marketing_productos;
create policy mk_productos_miembro_all on public.marketing_productos
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists mk_brands_miembro_all on public.marketing_brands;
create policy mk_brands_miembro_all on public.marketing_brands
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists mk_ads_miembro_all on public.marketing_ads;
create policy mk_ads_miembro_all on public.marketing_ads
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists mk_ideas_miembro_all on public.marketing_ideas;
create policy mk_ideas_miembro_all on public.marketing_ideas
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists mk_creativos_miembro_all on public.marketing_creativos;
create policy mk_creativos_miembro_all on public.marketing_creativos
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists mk_referencias_miembro_all on public.marketing_referencias;
create policy mk_referencias_miembro_all on public.marketing_referencias
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

drop policy if exists prod_imagenes_miembro_all on public.producto_imagenes;
create policy prod_imagenes_miembro_all on public.producto_imagenes
  for all using (user_id = public.miembro_owner('productos'))
  with check (user_id = public.miembro_owner('productos'));

-- ── Área 'metricas' (Testeos semanales + Métricas) ───────────────────────────
drop policy if exists testeos_cfg_miembro_all on public.testeos_config;
create policy testeos_cfg_miembro_all on public.testeos_config
  for all using (user_id = public.miembro_owner('metricas'))
  with check (user_id = public.miembro_owner('metricas'));

drop policy if exists testeos_snap_miembro_all on public.testeos_snapshots;
create policy testeos_snap_miembro_all on public.testeos_snapshots
  for all using (user_id = public.miembro_owner('metricas'))
  with check (user_id = public.miembro_owner('metricas'));

-- ── Área 'produccion' (tablero del área creativa, como un admin del área) ───
drop policy if exists prod_asig_miembro_all on public.produccion_asignaciones;
create policy prod_asig_miembro_all on public.produccion_asignaciones
  for all using (owner_id = public.miembro_owner('produccion'))
  with check (owner_id = public.miembro_owner('produccion'));

-- ── Área 'landings' ──────────────────────────────────────────────────────────
drop policy if exists landings_miembro_all on public.landings;
create policy landings_miembro_all on public.landings
  for all using (owner_id = public.miembro_owner('landings'))
  with check (owner_id = public.miembro_owner('landings'));
