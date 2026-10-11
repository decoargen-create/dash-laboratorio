-- Migration 0036 — Referencias de Instagram (reels que el admin guarda como
-- referencia creativa para que los editores los repliquen).
--
-- Flujo: el admin pega un link de IG en la tab "Referencias" → el server lo
-- scrapea vía Apify, persiste el mp4 + miniatura en el bucket `creativos`
-- (las URLs del CDN de IG expiran) y guarda la metadata acá. Opcionalmente se
-- transcribe (Whisper) y analiza (Claude: ángulo/hooks), y se genera el guion
-- adaptado al producto. Después se "adjunta" a las tarjetas de Producción
-- (columna jsonb desnormalizada, mismo patrón que winners/material_link: el
-- editor solo puede leer SUS tarjetas, así que la referencia viaja en la fila).

create table if not exists public.marketing_referencias (
  id text not null,                           -- client/server generated ref_ig_<shortcode>_<ts>
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text,                           -- producto de marketing al que pertenece (opcional)
  url text not null,                          -- link original que pegó el user
  shortcode text,                             -- código del post/reel (p/reel/tv)
  platform text default 'ig',
  caption text,
  owner_username text,
  video_duration numeric,
  -- Bytes en Supabase Storage (bucket privado `creativos`):
  --   video: <user_id>/referencias/<id>.mp4   thumb: <user_id>/referencias/<id>_thumb.jpg
  video_storage_path text,
  thumb_storage_path text,
  -- IA (se completan con "Analizar con IA" / "Guion para editor")
  transcript text,
  idioma text,
  analisis jsonb,                             -- { hooks, angle, triggers, visual, estructura, why_it_works }
  guion jsonb,                                -- output de adaptar-guion-video { guion, hooksAlternativos, notasEditor, ... }
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists idx_marketing_referencias_user_producto
  on public.marketing_referencias(user_id, producto_id);
create index if not exists idx_marketing_referencias_created
  on public.marketing_referencias(user_id, created_at desc);

alter table public.marketing_referencias enable row level security;
drop policy if exists "referencias_self_all" on public.marketing_referencias;
create policy "referencias_self_all" on public.marketing_referencias
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Referencias en las tarjetas de Producción — jsonb array desnormalizado,
-- calcado de `winners` (0030): se copia a TODAS las tarjetas del producto así
-- el editor asignado lo ve (la RLS solo le deja leer sus propias filas).
-- referencias = [{ id, url, shortcode, caption, owner, angle, hooks,
--                  guion, notasEditor, hooksAlternativos, ts }]
-- Columna opcional con feature-detection en el front (como winners): si la
-- migración todavía no se aplicó, se guarda local pero no rompe los writes.
alter table public.produccion_asignaciones
  add column if not exists referencias jsonb not null default '[]'::jsonb;
