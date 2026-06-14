-- Soporte multi-plataforma en marketing_ads. Hasta ahora solo había ads de
-- Facebook Ad Library (platform implícito). Agregamos columna `platform`
-- para diferenciar TikTok / FB / IG sin romper backward compat.
--
-- Default = 'facebook' para todas las filas existentes (todas son del scrape
-- de FB Ad Library).

alter table public.marketing_ads
  add column if not exists platform text not null default 'facebook';

create index if not exists marketing_ads_platform_idx
  on public.marketing_ads (user_id, platform, scraped_at desc);

-- search_vector ya está, no necesita cambios. La búsqueda full-text aplica a
-- todas las plataformas por igual.

comment on column public.marketing_ads.platform is
  'Plataforma del ad: facebook | tiktok | ig. Default facebook por backward compat.';
