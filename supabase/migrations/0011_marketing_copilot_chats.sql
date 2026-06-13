-- =========================================================================
-- MARKETING_COPILOT_CHATS — historial del chat del Copiloto, por usuario y
-- por producto.
--
-- Antes el historial vivía SOLO en localStorage (adslab-marketing-copilot-
-- <productoId>), así que cada conversación quedaba atrapada en el navegador
-- donde se hizo: no se respaldaba ni se veía desde otra PC. Esta tabla lo
-- lleva a la nube. El cliente sigue usando localStorage como CACHE (para
-- pintar al instante), pero la fuente de verdad pasa a ser esta tabla.
--
-- Una fila por (user_id, producto_id). messages = array jsonb de
-- { role: 'user'|'assistant', content: string } (capado a los últimos N en
-- el cliente antes de guardar).
-- =========================================================================

create table if not exists public.marketing_copilot_chats (
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text not null,            -- productos.id es text (id local)
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, producto_id)
);

create index if not exists idx_marketing_copilot_chats_user
  on public.marketing_copilot_chats(user_id);

-- RLS: cada usuario ve/escribe solo sus propios chats.
alter table public.marketing_copilot_chats enable row level security;
drop policy if exists "copilot_chats_self_all" on public.marketing_copilot_chats;
create policy "copilot_chats_self_all" on public.marketing_copilot_chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Touch trigger (touch_updated_at() ya existe desde 0001_marketing_init.sql).
drop trigger if exists trg_touch_copilot_chats on public.marketing_copilot_chats;
create trigger trg_touch_copilot_chats before update on public.marketing_copilot_chats
  for each row execute procedure public.touch_updated_at();
