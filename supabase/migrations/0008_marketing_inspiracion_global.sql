-- =========================================================================
-- MARKETING_INSPIRACION_GLOBAL — marcas que el user usa como inspiración
-- cross-producto (no son competidores directos de UN producto, son
-- referentes para aprender ángulos / formato / hooks)
--
-- Diferencia con marketing_brands:
--   - marketing_brands: per-producto. Las brands son competidores del
--     producto X.
--   - marketing_inspiracion_global: per-user. Sirven para TODOS los
--     productos. Ejemplo: Liquid Death, Glossier, Apple — marcas que el
--     user admira por ángulo/estilo independientemente del vertical.
--
-- Shape de data (jsonb):
--   {
--     nombre: string,
--     fbPageUrl?: string,
--     landingUrl?: string,
--     notes?: string,        // por qué esta marca está acá
--     tags?: string[],       // ['hook-style', 'minimalismo', etc]
--     ads?: Ad[],            // scrapeados via Apify (mismo shape que brands)
--     analysis?: object,     // deep-analyze results
--     lastAdsCheck?: string, // ISO timestamp
--     adsTotal?: number,
--     winnersCount?: number,
--   }
-- =========================================================================

create table if not exists public.marketing_inspiracion_global (
  id text not null,                   -- client-generated
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists idx_marketing_inspiracion_global_user
  on public.marketing_inspiracion_global(user_id);
create index if not exists idx_marketing_inspiracion_global_updated
  on public.marketing_inspiracion_global(updated_at desc);

-- RLS
alter table public.marketing_inspiracion_global enable row level security;
drop policy if exists "inspiracion_global_self_all" on public.marketing_inspiracion_global;
create policy "inspiracion_global_self_all" on public.marketing_inspiracion_global
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Touch trigger
drop trigger if exists trg_touch_inspiracion_global on public.marketing_inspiracion_global;
create trigger trg_touch_inspiracion_global before update on public.marketing_inspiracion_global
  for each row execute procedure public.touch_updated_at();

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'marketing_inspiracion_global'
  ) then
    alter publication supabase_realtime add table public.marketing_inspiracion_global;
  end if;
end$$;

alter table public.marketing_inspiracion_global replica identity full;
