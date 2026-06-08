-- Migration 0001 — Marketing platform: productos, brands, prefs, imágenes.
-- Multi-tenant: cada user ve solo lo suyo (RLS sobre auth.uid()).
--
-- Convención: IDs de productos y brands son client-generated (string) para
-- compat con el localStorage existente, no UUID. user_id sí es UUID de
-- auth.users (Supabase Auth).

-- =========================================================================
-- PROFILES — extiende auth.users con metadata propia
-- =========================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text default 'user',           -- 'user' | 'admin' (por si después invitamos)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-crear profile cuando alguien se signupea.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================================
-- MARKETING_PRODUCTOS — la lista de productos del user
-- =========================================================================
create table if not exists public.marketing_productos (
  id text not null,                   -- client-generated (compat con localStorage existente)
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,                -- el producto completo (nombre, descripcion, competidores, docs, config)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)           -- mismo id puede existir entre users distintos
);

create index if not exists idx_marketing_productos_user on public.marketing_productos(user_id);
create index if not exists idx_marketing_productos_updated on public.marketing_productos(updated_at desc);

-- =========================================================================
-- MARKETING_BRANDS — marcas scrapeadas por producto (de Inspiración)
-- =========================================================================
create table if not exists public.marketing_brands (
  producto_id text not null,
  brand_id text not null,             -- client-generated dentro del producto
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,                -- el brand completo
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, producto_id, brand_id)
);

create index if not exists idx_marketing_brands_user_producto on public.marketing_brands(user_id, producto_id);

-- =========================================================================
-- MARKETING_PREFS — preferencias y UI state per-user (1 fila por user)
-- =========================================================================
create table if not exists public.marketing_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_producto_id text,
  gen_opts jsonb,                     -- { n, size, quality }
  updated_at timestamptz default now()
);

-- =========================================================================
-- PRODUCTO_IMAGENES — foto del producto + brand accent color por producto
-- =========================================================================
-- La imagen como tal vive en Supabase Storage (bucket 'producto-images'),
-- acá guardamos la URL pública + metadata.
create table if not exists public.producto_imagenes (
  producto_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text,                     -- URL pública de Supabase Storage
  accent_color text,                  -- hex de color de marca (#FF6B35)
  updated_at timestamptz default now(),
  primary key (user_id, producto_id)
);

-- =========================================================================
-- RLS — Row Level Security. Cada user ve solo sus filas.
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.marketing_productos enable row level security;
alter table public.marketing_brands enable row level security;
alter table public.marketing_prefs enable row level security;
alter table public.producto_imagenes enable row level security;

-- profiles: el user ve y edita SU propio profile
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id);

-- marketing_productos: CRUD completo sobre filas con user_id = auth.uid()
drop policy if exists "productos_self_all" on public.marketing_productos;
create policy "productos_self_all" on public.marketing_productos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- marketing_brands: idem
drop policy if exists "brands_self_all" on public.marketing_brands;
create policy "brands_self_all" on public.marketing_brands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- marketing_prefs: idem
drop policy if exists "prefs_self_all" on public.marketing_prefs;
create policy "prefs_self_all" on public.marketing_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- producto_imagenes: idem
drop policy if exists "imagenes_self_all" on public.producto_imagenes;
create policy "imagenes_self_all" on public.producto_imagenes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================================
-- Trigger genérico para mantener updated_at sin tener que enviarlo desde el client
-- =========================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_touch_productos on public.marketing_productos;
create trigger trg_touch_productos before update on public.marketing_productos
  for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_touch_brands on public.marketing_brands;
create trigger trg_touch_brands before update on public.marketing_brands
  for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_touch_prefs on public.marketing_prefs;
create trigger trg_touch_prefs before update on public.marketing_prefs
  for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_touch_imagenes on public.producto_imagenes;
create trigger trg_touch_imagenes before update on public.producto_imagenes
  for each row execute procedure public.touch_updated_at();
