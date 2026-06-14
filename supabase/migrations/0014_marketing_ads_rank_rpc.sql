-- RPC para buscar ads ordenados por relevancia (ts_rank).
-- supabase-js no expone order by sobre expresiones SQL — necesitamos RPC.

create or replace function public.search_ads_ranked(
  q text,
  filter_producto text default null,
  filter_competidor text default null,
  filter_only_winners boolean default false,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  user_id uuid,
  producto_id text,
  competidor_id text,
  ad_id text,
  page_name text,
  page_id text,
  headline text,
  body text,
  ocr_text text,
  transcript text,
  formato text,
  days_running integer,
  is_winner boolean,
  winner_tier text,
  score numeric,
  variantes integer,
  platforms text[],
  is_multiplatform boolean,
  image_url text,
  video_url text,
  snapshot_url text,
  start_date timestamptz,
  scraped_at timestamptz,
  rank real,
  total_count bigint
)
language plpgsql security definer set search_path = public as $$
declare
  ts_q tsquery;
  total bigint;
begin
  -- Construir tsquery con websearch (soporta operadores naturales).
  ts_q := websearch_to_tsquery('spanish', coalesce(q, ''));

  -- Contar total para paginación.
  select count(*) into total
  from public.marketing_ads a
  where a.user_id = auth.uid()
    and (filter_producto is null or a.producto_id = filter_producto)
    and (filter_competidor is null or a.competidor_id = filter_competidor)
    and (not filter_only_winners or a.is_winner = true)
    and (q is null or q = '' or a.search_vector @@ ts_q);

  return query
  select
    a.user_id, a.producto_id, a.competidor_id, a.ad_id,
    a.page_name, a.page_id, a.headline, a.body,
    a.ocr_text, a.transcript, a.formato, a.days_running,
    a.is_winner, a.winner_tier, a.score, a.variantes,
    a.platforms, a.is_multiplatform, a.image_url, a.video_url,
    a.snapshot_url, a.start_date, a.scraped_at,
    ts_rank(a.search_vector, ts_q) as rank,
    total as total_count
  from public.marketing_ads a
  where a.user_id = auth.uid()
    and (filter_producto is null or a.producto_id = filter_producto)
    and (filter_competidor is null or a.competidor_id = filter_competidor)
    and (not filter_only_winners or a.is_winner = true)
    and (q is null or q = '' or a.search_vector @@ ts_q)
  order by
    case when q is null or q = '' then 0 else ts_rank(a.search_vector, ts_q) end desc,
    a.scraped_at desc
  offset page_offset
  limit page_size;
end $$;
