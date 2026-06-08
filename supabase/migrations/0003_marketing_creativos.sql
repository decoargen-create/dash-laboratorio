-- Migration 0003 — tabla marketing_creativos + bucket creativos para Storage.
--
-- Hasta ahora los creativos generados vivían 100% en IndexedDB local:
-- problema → no se sincronizaban multi-PC. Esta migración los mueve al
-- cloud: metadata + flags acá, bytes de la imagen en Supabase Storage
-- (bucket 'creativos').
--
-- Para crear el bucket de Storage, ver el prompt para Cowork. La policy
-- de RLS del bucket está abajo (SQL aplicable solo si el bucket existe).

create table if not exists public.marketing_creativos (
  id text not null,                          -- client-generated ref_<ts>_<adId>_<i>
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text,                          -- producto al que pertenece
  -- Origen del creativo
  source_ad_id text,
  source_brand text,
  source_image_url text,                     -- URL del ad ref de Meta CDN
  source_headline text,
  source_type text default 'inspiracion',    -- 'inspiracion' | 'bandeja-idea'
  -- Variante
  variant_index int,
  variant_style text,                        -- 'reference' | 'rebrand' | 'strategist' | 'bandeja' | 'tight' | 'medium' | 'loose'
  -- Generación
  prompt text,
  skeleton jsonb,
  model text,
  vision_model text,
  size text,
  size_fallback boolean default false,
  quality text,
  -- Storage: el bytes vive en Supabase Storage bucket 'creativos'.
  -- storage_path es la ruta dentro del bucket: '<user_id>/<id>.png'
  storage_path text,
  image_url text,                            -- URL pública/firmada para mostrar
  mime_type text default 'image/png',
  -- Flags
  descargada boolean default false,
  descargada_at timestamptz,
  archivado boolean default false,
  archivado_at timestamptz,
  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists idx_marketing_creativos_user_producto
  on public.marketing_creativos(user_id, producto_id);
create index if not exists idx_marketing_creativos_user_producto_archivado
  on public.marketing_creativos(user_id, producto_id, archivado);
create index if not exists idx_marketing_creativos_created_at
  on public.marketing_creativos(user_id, created_at desc);

-- RLS
alter table public.marketing_creativos enable row level security;
drop policy if exists "creativos_self_all" on public.marketing_creativos;
create policy "creativos_self_all" on public.marketing_creativos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger touch
drop trigger if exists trg_touch_creativos on public.marketing_creativos;
create trigger trg_touch_creativos before update on public.marketing_creativos
  for each row execute procedure public.touch_updated_at();

-- =========================================================================
-- STORAGE policies para bucket 'creativos'
-- =========================================================================
-- El bucket se crea desde la UI de Supabase (Storage → New bucket → public).
-- Una vez creado, descomentar y correr lo de abajo para que el RLS de
-- storage.objects respete user_id por owner.

-- Si el bucket NO existe, este SQL falla con "bucket not found" — saltarlo.

do $$
begin
  -- Solo aplicar si el bucket existe
  if exists (select 1 from storage.buckets where id = 'creativos') then
    -- Política: cualquier auth user puede insertar archivos cuyo path
    -- arranca con su user_id. Ej: '<auth.uid>/abc.png' OK, otro path NO.
    execute $POLICY$
      drop policy if exists "creativos_user_upload" on storage.objects;
      create policy "creativos_user_upload" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'creativos'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $POLICY$;

    -- Política: cualquier user puede leer del bucket (es público).
    -- Para escrituras: solo el dueño.
    execute $POLICY$
      drop policy if exists "creativos_user_update" on storage.objects;
      create policy "creativos_user_update" on storage.objects
        for update to authenticated
        using (
          bucket_id = 'creativos'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $POLICY$;

    execute $POLICY$
      drop policy if exists "creativos_user_delete" on storage.objects;
      create policy "creativos_user_delete" on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'creativos'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    $POLICY$;

    raise notice 'Storage policies aplicadas para bucket creativos';
  else
    raise notice 'Bucket creativos NO existe — crealo en Supabase UI y corré este SQL de nuevo';
  end if;
end $$;
