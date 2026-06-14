-- Tabla de ads server-side para backend search & pagination.
--
-- POR QUÉ:
-- Hoy los ads viven en IDB local (per-user device) + bucket cloud (JSON
-- por competidor). La lupa filtra client-side iterando arrays, lo que NO
-- escala a 100K+ ads acumulados. Esta tabla los lleva a Postgres con
-- índices full-text para búsqueda rápida server-side.
--
-- Estrategia incremental:
-- - El cron (cron-competidor-refresh) además de subir el JSON al bucket
--   también UPSERTea cada ad acá.
-- - El user-trigger scrape (apify-ingest) hace lo mismo (background).
-- - Endpoint nuevo /api/marketing/search-ads consulta esta tabla con
--   GIN index full-text para latencia <100ms en cualquier tamaño.
-- - El cliente NO baja la tabla — solo pide pages de 50 ads.

create table if not exists public.marketing_ads (
  -- Composite key: user owns the ad, ad pertenece a un (producto, competidor),
  -- y el ad tiene un id único (de Meta Ad Library).
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text not null,
  competidor_id text not null,
  ad_id text not null,
  -- Metadata del ad (denormalizada para que el query no haga joins).
  page_name text,
  page_id text,
  headline text,
  body text,
  ocr_text text,
  transcript text,
  formato text,
  days_running integer,
  is_winner boolean default false,
  winner_tier text,
  score numeric,
  variantes integer,
  platforms text[],
  is_multiplatform boolean default false,
  image_url text,
  video_url text,
  snapshot_url text,
  start_date timestamptz,
  -- Full-text search vector (auto-updated via trigger).
  search_vector tsvector,
  -- Timestamps.
  scraped_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Primary key + indexes.
  primary key (user_id, producto_id, competidor_id, ad_id)
);

-- Indexes para query patterns típicos.
create index if not exists marketing_ads_user_producto_idx
  on public.marketing_ads (user_id, producto_id);
create index if not exists marketing_ads_user_competidor_idx
  on public.marketing_ads (user_id, producto_id, competidor_id);
create index if not exists marketing_ads_user_winner_idx
  on public.marketing_ads (user_id, is_winner) where is_winner = true;
create index if not exists marketing_ads_user_scraped_idx
  on public.marketing_ads (user_id, scraped_at desc);
-- GIN para full-text search sobre headline + body + ocr_text + transcript.
create index if not exists marketing_ads_search_idx
  on public.marketing_ads using gin (search_vector);

-- Trigger para mantener search_vector actualizado en insert/update.
create or replace function public.marketing_ads_update_search_vector()
returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('spanish', coalesce(new.headline, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(new.body, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(new.ocr_text, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(new.transcript, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(new.page_name, '')), 'D');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists marketing_ads_search_vector_trigger on public.marketing_ads;
create trigger marketing_ads_search_vector_trigger
  before insert or update on public.marketing_ads
  for each row execute function public.marketing_ads_update_search_vector();

-- RLS — cada user solo ve sus propios ads.
alter table public.marketing_ads enable row level security;
create policy "marketing_ads_self_all" on public.marketing_ads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime para que el cliente reciba updates cuando el cron escribe.
alter publication supabase_realtime add table public.marketing_ads;
