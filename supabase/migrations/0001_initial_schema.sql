-- ============================================================
-- Laboratorio Viora — Schema inicial Supabase
-- ============================================================
-- Para ejecutar: pegar este archivo entero en el SQL Editor de Supabase
-- y hacer click en "Run". Idempotente: las tablas y policies se crean
-- solo si no existen.

-- Workspace compartido. Por ahora una sola fila — el id queda fijo en
-- la env var VITE_WORKSPACE_ID así toda la app comparte el mismo.
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz default now()
);

-- Insertamos UN workspace inicial — copiá el id que devuelve esta query
-- y pegalo en Vercel como VITE_WORKSPACE_ID.
-- (Comentado para no duplicar al re-correr; descomentar la primera vez.)
-- insert into workspaces (nombre) values ('Laboratorio Viora') returning id;

-- ------------------------------------------------------------
-- PRODUCTOS
-- ------------------------------------------------------------
create table if not exists productos (
  id text primary key,                  -- preservamos los IDs locales para migración
  workspace_id uuid references workspaces(id) on delete cascade,
  nombre text not null,
  landing_url text,
  descripcion text,
  stage text,
  docs jsonb,                           -- { research, avatar, offerBrief, beliefs, resumenEjecutivo }
  competidores jsonb,                   -- array completo con ads + adsAnalysis + adsHistory
  meta_account jsonb,
  activo_visual jsonb,
  docs_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists productos_workspace on productos(workspace_id);

-- ------------------------------------------------------------
-- IDEAS DE LA BANDEJA
-- ------------------------------------------------------------
create table if not exists ideas (
  id text primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  producto_id text references productos(id) on delete cascade,
  titulo text,
  tipo text,                            -- replica/iteracion/diferenciacion/desde_cero
  formato text,                         -- video/static/carrusel
  hook text,
  copy_post_meta text,
  descripcion_imagen text,
  prompt_generador_imagen text,
  texto_en_imagen text,
  guion text,
  guion_adaptado jsonb,
  angulo text,
  angulo_categoria text,
  tipo_campania text,
  pain_point text,
  estilo_visual text,
  score_value numeric,
  low_score boolean,
  score_reason text,
  meta_riesgo jsonb,
  variable_de_testeo text,
  test_hipotesis text,
  creencia_apalancada text,
  escenario_narrativo text,
  publico_sugerido text,
  estado text default 'pendiente',
  origen jsonb,
  ad_id text,                           -- index para deduplicación rápida
  notas text,
  used_at timestamptz,
  used_ad_id text,
  created_at timestamptz default now()
);
create index if not exists ideas_producto on ideas(producto_id);
create index if not exists ideas_estado on ideas(estado);
create index if not exists ideas_ad_id on ideas(ad_id);
create index if not exists ideas_workspace on ideas(workspace_id);

-- ------------------------------------------------------------
-- RUN HISTORY DEL PIPELINE
-- ------------------------------------------------------------
create table if not exists run_history (
  id text primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  producto_id text references productos(id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms integer,
  status text,
  cost jsonb,
  stats jsonb,
  steps jsonb,
  cancelled boolean default false
);
create index if not exists run_history_producto on run_history(producto_id);
create index if not exists run_history_workspace on run_history(workspace_id);

-- ------------------------------------------------------------
-- COSTS LOG
-- ------------------------------------------------------------
create table if not exists costs_log (
  id bigserial primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  auto_tipo text,                       -- anthropic/openai/apify/meta
  amount numeric,
  descripcion text,
  created_at timestamptz default now()
);
create index if not exists costs_log_workspace on costs_log(workspace_id);
create index if not exists costs_log_created on costs_log(created_at);

-- ------------------------------------------------------------
-- CREATIVOS (referencia al PNG en Supabase Storage)
-- ------------------------------------------------------------
create table if not exists creativos (
  idea_id text primary key references ideas(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  storage_path text not null,           -- path dentro del bucket "creativos"
  mime_type text,
  size text,
  quality text,
  model text,
  generated_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists creativos_workspace on creativos(workspace_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Por ahora: cualquier usuario autenticado tiene acceso completo a todas
-- las tablas. Cuando sumemos multi-workspace/multi-rol, refinamos.

alter table workspaces enable row level security;
alter table productos enable row level security;
alter table ideas enable row level security;
alter table run_history enable row level security;
alter table costs_log enable row level security;
alter table creativos enable row level security;

drop policy if exists "auth full access" on workspaces;
create policy "auth full access" on workspaces for all using (auth.role() = 'authenticated');

drop policy if exists "auth full access" on productos;
create policy "auth full access" on productos for all using (auth.role() = 'authenticated');

drop policy if exists "auth full access" on ideas;
create policy "auth full access" on ideas for all using (auth.role() = 'authenticated');

drop policy if exists "auth full access" on run_history;
create policy "auth full access" on run_history for all using (auth.role() = 'authenticated');

drop policy if exists "auth full access" on costs_log;
create policy "auth full access" on costs_log for all using (auth.role() = 'authenticated');

drop policy if exists "auth full access" on creativos;
create policy "auth full access" on creativos for all using (auth.role() = 'authenticated');

-- ============================================================
-- STORAGE BUCKET para los PNGs de creativos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('creativos', 'creativos', false)
on conflict (id) do nothing;

drop policy if exists "auth read creativos" on storage.objects;
create policy "auth read creativos" on storage.objects for select
  using (bucket_id = 'creativos' and auth.role() = 'authenticated');

drop policy if exists "auth write creativos" on storage.objects;
create policy "auth write creativos" on storage.objects for insert
  with check (bucket_id = 'creativos' and auth.role() = 'authenticated');

drop policy if exists "auth update creativos" on storage.objects;
create policy "auth update creativos" on storage.objects for update
  using (bucket_id = 'creativos' and auth.role() = 'authenticated');

drop policy if exists "auth delete creativos" on storage.objects;
create policy "auth delete creativos" on storage.objects for delete
  using (bucket_id = 'creativos' and auth.role() = 'authenticated');
