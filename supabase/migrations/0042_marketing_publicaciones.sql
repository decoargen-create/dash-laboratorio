-- Historial de publicaciones del Publicador: una fila por cada campaña que
-- el publicador intentó crear (exitosa, parcial, deshecha por rollback o
-- fallida). La escribe el SERVER (service role) al final de
-- create-campaign-structure; el cliente solo la lee (RLS self).
create table if not exists public.marketing_publicaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  account_id text,
  campaign_id text,
  campaign_name text,
  producto text,
  estado text,            -- ACTIVE | PAUSED | DELETED | ERROR
  ads_ok int default 0,
  ads_total int default 0,
  error text,
  log jsonb default '[]'::jsonb,
  resultados jsonb default '[]'::jsonb
);

create index if not exists idx_mkt_publicaciones_user_fecha
  on public.marketing_publicaciones (user_id, created_at desc);

alter table public.marketing_publicaciones enable row level security;

drop policy if exists "publicaciones self select" on public.marketing_publicaciones;
create policy "publicaciones self select" on public.marketing_publicaciones
  for select using (auth.uid() = user_id);
-- Sin policy de insert/update/delete para authenticated: solo escribe el
-- service role del server.
