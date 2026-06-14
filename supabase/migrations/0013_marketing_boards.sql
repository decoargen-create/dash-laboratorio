-- Boards cross-product: el user guarda ads en colecciones nombradas
-- ("Winners Q4 2026", "Hooks de dolor", etc) que cruzan productos.
--
-- Casos de uso:
-- - Coleccionar inspiración aún si no es del producto activo.
-- - Construir un brief de ideas con ejemplos curados.
-- - Compartir el board con el equipo (futuro).
--
-- Tablas:
-- - marketing_boards: el board en sí.
-- - marketing_board_items: relación N:M con un ad (producto, comp, ad_id).
--
-- Los ads referenciados ya viven en marketing_ads — acá solo guardamos la
-- referencia + notes opcionales del user sobre por qué guardó ese ad.

create table if not exists public.marketing_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  descripcion text,
  color text default 'amber', -- emerald|amber|brand|violet|blue|red|gray
  icon text default 'star',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_boards_user_idx
  on public.marketing_boards (user_id, updated_at desc);

create table if not exists public.marketing_board_items (
  board_id uuid not null references public.marketing_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Ref al ad: composite por consistencia con marketing_ads.
  producto_id text not null,
  competidor_id text not null,
  ad_id text not null,
  notas text,
  added_at timestamptz not null default now(),
  primary key (board_id, ad_id)
);

create index if not exists marketing_board_items_user_idx
  on public.marketing_board_items (user_id, added_at desc);
create index if not exists marketing_board_items_board_idx
  on public.marketing_board_items (board_id, added_at desc);

-- RLS
alter table public.marketing_boards enable row level security;
alter table public.marketing_board_items enable row level security;

create policy "boards_self_all" on public.marketing_boards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "board_items_self_all" on public.marketing_board_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime
alter publication supabase_realtime add table public.marketing_boards;
alter publication supabase_realtime add table public.marketing_board_items;
