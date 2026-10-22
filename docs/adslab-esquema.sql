-- =============================================================================
-- AdsLab — esquema de Supabase (solo ESTRUCTURA)
-- =============================================================================
-- Sacado del catálogo de la base de producción (Postgres 17) el 2026-10-22.
-- Incluye: tablas, columnas con su tipo, claves, índices, funciones, triggers,
-- políticas RLS, el bucket de Storage y la publicación de Realtime.
-- NO incluye datos, claves ni URLs.
--
-- La base es compartida con otros sistemas (facturación, logística, finanzas,
-- RRHH, consultoría, etc.): sus tablas quedan AFUERA de este archivo.
--
-- Convención general:
--   * Multi-tenant por dueño: user_id / owner_id = auth.users.id del dueño de
--     la cuenta. Los miembros del equipo acceden a los datos del dueño vía
--     cuenta_miembros + la función miembro_owner(area).
--   * Varias tablas guardan el objeto del front casi entero en `data jsonb`
--     (productos, marcas, ideas): el esquema fino de esos JSON vive en el
--     código (src/marketingSync.js, src/Arranque.jsx, src/InspiracionSection.jsx).
--   * El backend (funciones de Vercel en /api) usa la service role y saltea RLS;
--     el front usa la anon key + sesión del usuario y pasa por RLS.
--
-- -----------------------------------------------------------------------------
-- TABLAS (para qué sirve cada una)
-- -----------------------------------------------------------------------------
-- Cuentas y plan
--   profiles                    Perfil de cada usuario (nombre, rol, plan viejo).
--   cuenta_miembros             Miembros del equipo de un dueño y a qué áreas acceden.
--   suscripciones               Plan comercial de cada cuenta y créditos usados/extra del período.
--   creditos_eventos            Ledger de créditos: cada consumo o carga (+/-).
--   user_prefs                  Preferencias del usuario (JSON libre).
--   uso_secciones               Log de qué sección abre cada usuario (analítica interna).
--   integration_health          Estado caído/ok de integraciones y cuándo se avisó.
-- Conexiones externas
--   meta_connections            Tokens de Meta (Facebook) de cada usuario, uno por conexión.
--   google_oauth                Refresh token de Google Drive del dueño + estado de Drive.
-- Estáticos / Inspiración
--   marketing_productos         Productos del usuario (todo el producto en `data`: setup, formato, ofertas, palabras clave…).
--   producto_imagenes           Foto principal y color de acento de cada producto.
--   marketing_brands            Marcas/competidores de referencia de cada producto (en `data`).
--   marketing_ads               Anuncios scrapeados de la Biblioteca de Meta por competidor (texto, OCR, transcripción, imagen, días activo, score).
--   marketing_inspiracion_global Biblioteca de inspiración global vieja (en `data`). Hoy el código no la usa.
--   marketing_creativos         Estáticos generados con IA (prompt, modelo, tamaño, archivo en Storage, winner, archivado).
--   marketing_ideas             Ideas de anuncios generadas con IA por producto (en `data`). Hoy oculto en el front.
--   marketing_referencias       Reels/posts de Instagram guardados como referencia (video, transcripción, análisis, guion).
--   marketing_costs             Gasto de IA/scraping por usuario, producto y tipo (para el panel de costos).
--   marketing_prefs             Producto activo y opciones de generación del usuario.
--   marketing_copilot_chats     Historial del chat copiloto por producto.
--   marketing_boards            Tableros para guardar anuncios favoritos.
--   marketing_board_items       Anuncios guardados en cada tablero.
-- Anuncios (Meta)
--   marketing_publicaciones     Log de cada publicación de campaña/anuncios a Meta desde el Publicador.
--   testeos_config              Configuración de testeos por cuenta publicitaria.
--   testeos_snapshots           Cierre semanal de testeos por cuenta y producto.
--   auto_winners_config         Config global (fila única) de detección automática de anuncios ganadores.
--   auto_winners_owner_config   La misma config de ganadores, por dueño.
-- Área creativa
--   landings                    Landings en revisión con su checklist (Área creativa → Landings).
--   produccion_asignaciones     Tarjetas del tablero de producción de videos (tipo Trello): editor, estado, archivos, winners.
--   produccion_jerarquia        Qué líder supervisa a qué editor dentro de un dueño.
--   produccion_notif_config     Config de notificaciones del tablero de producción.
--   produccion_pagos            Pagos a editores por semana (pagado / fecha).
--   produccion_pago_config      Tarifa por producto y bonus por tramos de cada editor.
-- =============================================================================


-- =============================================================================
-- 1. TABLAS
-- =============================================================================

-- ---------- Cuentas y plan ----------

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text,
  display_name text,
  plan text DEFAULT 'free'::text,
  copy_count_month integer DEFAULT 0,
  last_copy_reset timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  role text DEFAULT 'user'::text,
  is_owner boolean DEFAULT false NOT NULL,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'agency'::text])))
);

CREATE TABLE public.cuenta_miembros (
  member_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  display_name text DEFAULT ''::text,
  areas text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cuenta_miembros_pkey PRIMARY KEY (member_id),
  CONSTRAINT cuenta_miembros_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT cuenta_miembros_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX cuenta_miembros_owner_idx ON public.cuenta_miembros USING btree (owner_id);

CREATE TABLE public.suscripciones (
  user_id uuid NOT NULL,
  plan text DEFAULT 'trial'::text NOT NULL,
  estado text DEFAULT 'activa'::text NOT NULL,
  periodo_inicio timestamp with time zone DEFAULT now() NOT NULL,
  periodo_fin timestamp with time zone,
  creditos_usados integer DEFAULT 0 NOT NULL,
  creditos_extra integer DEFAULT 0 NOT NULL,
  provider text,
  provider_ref text,
  notas text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT suscripciones_pkey PRIMARY KEY (user_id),
  CONSTRAINT suscripciones_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT suscripciones_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'vencida'::text, 'cancelada'::text]))),
  CONSTRAINT suscripciones_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'starter'::text, 'pro'::text, 'agencia'::text, 'fundador'::text])))
);

CREATE TABLE public.creditos_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  motivo text NOT NULL,
  ref text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT creditos_eventos_pkey PRIMARY KEY (id),
  CONSTRAINT creditos_eventos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX creditos_eventos_user_idx ON public.creditos_eventos USING btree (user_id, created_at DESC);

CREATE TABLE public.user_prefs (
  user_id uuid NOT NULL,
  prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_prefs_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.uso_secciones (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  seccion text NOT NULL,
  ts timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT uso_secciones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.integration_health (
  integration text NOT NULL,
  down boolean DEFAULT false NOT NULL,
  alert_at timestamp with time zone,
  warned_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT integration_health_pkey PRIMARY KEY (integration)
);

-- ---------- Conexiones externas ----------

CREATE TABLE public.meta_connections (
  id text NOT NULL,
  user_id uuid NOT NULL,
  label text,
  meta_user_id text,
  meta_user_name text,
  access_token text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT meta_connections_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT meta_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_meta_connections_user ON public.meta_connections USING btree (user_id);

CREATE TABLE public.google_oauth (
  id uuid NOT NULL,
  email text,
  refresh_token text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  drive_down boolean DEFAULT false NOT NULL,
  drive_alert_at timestamp with time zone,
  CONSTRAINT google_oauth_pkey PRIMARY KEY (id),
  CONSTRAINT google_oauth_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ---------- Estáticos / Inspiración ----------

CREATE TABLE public.marketing_productos (
  id text NOT NULL,
  user_id uuid NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_productos_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT marketing_productos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_productos_user ON public.marketing_productos USING btree (user_id);
CREATE INDEX idx_marketing_productos_updated ON public.marketing_productos USING btree (updated_at DESC);

CREATE TABLE public.producto_imagenes (
  producto_id text NOT NULL,
  user_id uuid NOT NULL,
  image_url text,
  accent_color text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT producto_imagenes_pkey PRIMARY KEY (user_id, producto_id),
  CONSTRAINT producto_imagenes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.marketing_brands (
  producto_id text NOT NULL,
  brand_id text NOT NULL,
  user_id uuid NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_brands_pkey PRIMARY KEY (user_id, producto_id, brand_id),
  CONSTRAINT marketing_brands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_brands_user_producto ON public.marketing_brands USING btree (user_id, producto_id);

CREATE TABLE public.marketing_ads (
  user_id uuid NOT NULL,
  producto_id text NOT NULL,
  competidor_id text NOT NULL,
  ad_id text NOT NULL,
  page_name text,
  page_id text,
  headline text,
  body text,
  ocr_text text,
  transcript text,
  formato text,
  days_running integer,
  is_winner boolean DEFAULT false,
  winner_tier text,
  score numeric,
  variantes integer,
  platforms text[],
  is_multiplatform boolean DEFAULT false,
  image_url text,
  video_url text,
  snapshot_url text,
  start_date timestamp with time zone,
  search_vector tsvector,
  scraped_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  platform text DEFAULT 'facebook'::text NOT NULL,
  CONSTRAINT marketing_ads_pkey PRIMARY KEY (user_id, producto_id, competidor_id, ad_id),
  CONSTRAINT marketing_ads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX marketing_ads_user_competidor_idx ON public.marketing_ads USING btree (user_id, producto_id, competidor_id);
CREATE INDEX marketing_ads_user_winner_idx ON public.marketing_ads USING btree (user_id, is_winner) WHERE (is_winner = true);
CREATE INDEX marketing_ads_search_idx ON public.marketing_ads USING gin (search_vector);
CREATE INDEX marketing_ads_user_producto_idx ON public.marketing_ads USING btree (user_id, producto_id);
CREATE INDEX marketing_ads_platform_idx ON public.marketing_ads USING btree (user_id, platform, scraped_at DESC);
CREATE INDEX marketing_ads_user_scraped_idx ON public.marketing_ads USING btree (user_id, scraped_at DESC);

CREATE TABLE public.marketing_inspiracion_global (
  id text NOT NULL,
  user_id uuid NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_inspiracion_global_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT marketing_inspiracion_global_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_inspiracion_global_updated ON public.marketing_inspiracion_global USING btree (updated_at DESC);
CREATE INDEX idx_marketing_inspiracion_global_user ON public.marketing_inspiracion_global USING btree (user_id);

CREATE TABLE public.marketing_creativos (
  id text NOT NULL,
  user_id uuid NOT NULL,
  producto_id text,
  source_ad_id text,
  source_brand text,
  source_image_url text,
  source_headline text,
  source_type text DEFAULT 'inspiracion'::text,
  variant_index integer,
  variant_style text,
  prompt text,
  skeleton jsonb,
  model text,
  vision_model text,
  size text,
  size_fallback boolean DEFAULT false,
  quality text,
  storage_path text,
  image_url text,
  mime_type text DEFAULT 'image/png'::text,
  descargada boolean DEFAULT false,
  descargada_at timestamp with time zone,
  archivado boolean DEFAULT false,
  archivado_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  winner boolean DEFAULT false,
  winner_at timestamp with time zone,
  winner_metrics jsonb,
  thumb_path text,
  angle text,
  evento text,
  CONSTRAINT marketing_creativos_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT marketing_creativos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_creativos_user_producto ON public.marketing_creativos USING btree (user_id, producto_id);
CREATE INDEX idx_marketing_creativos_created_at ON public.marketing_creativos USING btree (user_id, created_at DESC);
CREATE INDEX idx_marketing_creativos_user_producto_winner ON public.marketing_creativos USING btree (user_id, producto_id, winner) WHERE (winner = true);
CREATE INDEX idx_marketing_creativos_user_producto_archivado ON public.marketing_creativos USING btree (user_id, producto_id, archivado);

CREATE TABLE public.marketing_ideas (
  id text NOT NULL,
  user_id uuid NOT NULL,
  producto_id text,
  data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_ideas_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT marketing_ideas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_ideas_updated ON public.marketing_ideas USING btree (updated_at DESC);
CREATE INDEX idx_marketing_ideas_user ON public.marketing_ideas USING btree (user_id);
CREATE INDEX idx_marketing_ideas_user_producto ON public.marketing_ideas USING btree (user_id, producto_id);

CREATE TABLE public.marketing_referencias (
  id text NOT NULL,
  user_id uuid NOT NULL,
  producto_id text,
  url text NOT NULL,
  shortcode text,
  platform text DEFAULT 'ig'::text,
  caption text,
  owner_username text,
  video_duration numeric,
  video_storage_path text,
  thumb_storage_path text,
  transcript text,
  idioma text,
  analisis jsonb,
  guion jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_referencias_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT marketing_referencias_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_referencias_user_producto ON public.marketing_referencias USING btree (user_id, producto_id);
CREATE INDEX idx_marketing_referencias_created ON public.marketing_referencias USING btree (user_id, created_at DESC);

CREATE TABLE public.marketing_costs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  producto_id text,
  competidor_id text,
  auto_tipo text NOT NULL,
  amount numeric NOT NULL,
  descripcion text,
  kind text DEFAULT 'scrape'::text,
  source text DEFAULT 'cron'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id text,
  CONSTRAINT marketing_costs_pkey PRIMARY KEY (id),
  CONSTRAINT marketing_costs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX marketing_costs_user_producto_idx ON public.marketing_costs USING btree (user_id, producto_id, created_at DESC);
CREATE UNIQUE INDEX marketing_costs_user_client_idx ON public.marketing_costs USING btree (user_id, client_id);

CREATE TABLE public.marketing_prefs (
  user_id uuid NOT NULL,
  active_producto_id text,
  gen_opts jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_prefs_pkey PRIMARY KEY (user_id),
  CONSTRAINT marketing_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.marketing_copilot_chats (
  user_id uuid NOT NULL,
  producto_id text NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT marketing_copilot_chats_pkey PRIMARY KEY (user_id, producto_id),
  CONSTRAINT marketing_copilot_chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_marketing_copilot_chats_user ON public.marketing_copilot_chats USING btree (user_id);

CREATE TABLE public.marketing_boards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  color text DEFAULT 'amber'::text,
  icon text DEFAULT 'star'::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT marketing_boards_pkey PRIMARY KEY (id),
  CONSTRAINT marketing_boards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX marketing_boards_user_idx ON public.marketing_boards USING btree (user_id, updated_at DESC);

CREATE TABLE public.marketing_board_items (
  board_id uuid NOT NULL,
  user_id uuid NOT NULL,
  producto_id text NOT NULL,
  competidor_id text NOT NULL,
  ad_id text NOT NULL,
  notas text,
  added_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT marketing_board_items_pkey PRIMARY KEY (board_id, producto_id, competidor_id, ad_id),
  CONSTRAINT marketing_board_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.marketing_boards(id) ON DELETE CASCADE,
  CONSTRAINT marketing_board_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX marketing_board_items_board_idx ON public.marketing_board_items USING btree (board_id, added_at DESC);
CREATE INDEX marketing_board_items_user_idx ON public.marketing_board_items USING btree (user_id, added_at DESC);

-- ---------- Anuncios (Meta) ----------

CREATE TABLE public.marketing_publicaciones (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  account_id text,
  campaign_id text,
  campaign_name text,
  producto text,
  estado text,
  ads_ok integer DEFAULT 0,
  ads_total integer DEFAULT 0,
  error text,
  log jsonb DEFAULT '[]'::jsonb,
  resultados jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT marketing_publicaciones_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_mkt_publicaciones_user_fecha ON public.marketing_publicaciones USING btree (user_id, created_at DESC);

CREATE TABLE public.testeos_config (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  cfg jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT testeos_config_pkey PRIMARY KEY (user_id, account_id),
  CONSTRAINT testeos_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.testeos_snapshots (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  semana date NOT NULL,
  producto_id text DEFAULT ''::text NOT NULL,
  datos jsonb NOT NULL,
  cfg jsonb DEFAULT '{}'::jsonb NOT NULL,
  cerrada_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT testeos_snapshots_pkey PRIMARY KEY (user_id, account_id, semana, producto_id),
  CONSTRAINT testeos_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX testeos_snapshots_cuenta_idx ON public.testeos_snapshots USING btree (user_id, account_id, semana DESC);

CREATE TABLE public.auto_winners_config (
  id integer DEFAULT 1 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  account_ids text[] DEFAULT '{}'::text[] NOT NULL,
  ventana_dias integer DEFAULT 7 NOT NULL,
  min_compras integer DEFAULT 6 NOT NULL,
  min_roas numeric DEFAULT 2.5 NOT NULL,
  top_min integer DEFAULT 3 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT auto_winners_config_pkey PRIMARY KEY (id),
  CONSTRAINT auto_winners_config_id_check CHECK ((id = 1))
);

CREATE TABLE public.auto_winners_owner_config (
  owner_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  account_ids text[] DEFAULT '{}'::text[] NOT NULL,
  ventana_dias integer DEFAULT 7 NOT NULL,
  min_compras integer DEFAULT 6 NOT NULL,
  min_roas numeric DEFAULT 2.5 NOT NULL,
  top_min integer DEFAULT 3 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT auto_winners_owner_config_pkey PRIMARY KEY (owner_id),
  CONSTRAINT auto_winners_owner_config_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ---------- Área creativa ----------

CREATE TABLE public.landings (
  id text NOT NULL,
  owner_id uuid NOT NULL,
  creator_id uuid,
  producto_id text,
  producto_nombre text DEFAULT ''::text,
  url text DEFAULT ''::text,
  estado text DEFAULT 'revision'::text,
  editor text DEFAULT ''::text,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT landings_pkey PRIMARY KEY (id)
);
CREATE INDEX landings_owner_idx ON public.landings USING btree (owner_id);

CREATE TABLE public.produccion_asignaciones (
  id text NOT NULL,
  week_key text NOT NULL,
  producto_id text,
  producto_nombre text DEFAULT ''::text,
  persona text DEFAULT ''::text,
  creator_id uuid,
  tipo text DEFAULT 'renovado'::text NOT NULL,
  estado text DEFAULT 'porhacer'::text NOT NULL,
  videos_total integer DEFAULT 9 NOT NULL,
  videos_aprobados integer DEFAULT 0 NOT NULL,
  brief text DEFAULT ''::text,
  nota text DEFAULT ''::text,
  pagado boolean DEFAULT false NOT NULL,
  archivos jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  historial jsonb DEFAULT '[]'::jsonb NOT NULL,
  owner_id uuid,
  material_link text DEFAULT ''::text,
  winners jsonb DEFAULT '[]'::jsonb NOT NULL,
  etiqueta text,
  referencias jsonb DEFAULT '[]'::jsonb NOT NULL,
  prioridad integer,
  orden integer,
  CONSTRAINT produccion_asignaciones_pkey PRIMARY KEY (id),
  CONSTRAINT produccion_asignaciones_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT produccion_asignaciones_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX produccion_asig_owner_idx ON public.produccion_asignaciones USING btree (owner_id);
CREATE INDEX produccion_asig_creator_idx ON public.produccion_asignaciones USING btree (creator_id);
CREATE INDEX produccion_asig_week_idx ON public.produccion_asignaciones USING btree (week_key);

CREATE TABLE public.produccion_jerarquia (
  owner_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  lider_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT produccion_jerarquia_pkey PRIMARY KEY (owner_id, creator_id),
  CONSTRAINT produccion_jerarquia_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT produccion_jerarquia_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT produccion_jerarquia_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT produccion_jerarquia_no_self CHECK ((creator_id <> lider_id))
);
CREATE INDEX produccion_jerarquia_lider_idx ON public.produccion_jerarquia USING btree (lider_id);

CREATE TABLE public.produccion_notif_config (
  owner_id uuid NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT produccion_notif_config_pkey PRIMARY KEY (owner_id),
  CONSTRAINT produccion_notif_config_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.produccion_pagos (
  week_key text NOT NULL,
  persona text NOT NULL,
  paid boolean DEFAULT false NOT NULL,
  paid_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  owner_id uuid NOT NULL,
  CONSTRAINT produccion_pagos_pkey PRIMARY KEY (owner_id, week_key, persona),
  CONSTRAINT produccion_pagos_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.produccion_pago_config (
  owner_id uuid NOT NULL,
  persona text NOT NULL,
  creator_id uuid,
  pago_producto integer DEFAULT 42000 NOT NULL,
  bonus_tramos jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT produccion_pago_config_pkey PRIMARY KEY (owner_id, persona),
  CONSTRAINT produccion_pago_config_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT produccion_pago_config_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);


-- =============================================================================
-- 2. FUNCIONES
-- =============================================================================

-- Pone updated_at = now() en cada UPDATE (lo usan varios triggers).
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

-- Recalcula el índice de búsqueda full-text (español) de cada anuncio.
CREATE OR REPLACE FUNCTION public.marketing_ads_update_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.search_vector :=
    setweight(to_tsvector('spanish', coalesce(new.headline, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(new.body, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(new.ocr_text, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(new.transcript, '')), 'C') ||
    setweight(to_tsvector('spanish', coalesce(new.page_name, '')), 'D');
  new.updated_at := now();
  return new;
end $function$;

-- Dueño de la cuenta del usuario actual si es miembro (opcionalmente con
-- acceso a un área). La usan las políticas RLS "miembro".
CREATE OR REPLACE FUNCTION public.miembro_owner(p_area text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select owner_id from public.cuenta_miembros
  where member_id = auth.uid()
    and (p_area is null or p_area = any(areas))
  limit 1
$function$;

-- ¿El usuario actual es líder de ese editor dentro de ese dueño?
CREATE OR REPLACE FUNCTION public.produccion_lidera(p_owner uuid, p_creator uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.produccion_jerarquia j
    where j.owner_id = p_owner
      and j.creator_id = p_creator
      and j.lider_id = auth.uid()
  );
$function$;

-- Clave estable de un archivo dentro de produccion_asignaciones.archivos.
CREATE OR REPLACE FUNCTION public._archivo_key(f jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(nullif(f->>'ts',''), nullif(f->>'driveId',''), f->>'name')
$function$;

-- Clave estable de un winner dentro de produccion_asignaciones.winners.
CREATE OR REPLACE FUNCTION public._winner_key(w jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select lower(trim(coalesce(nullif(w->>'driveId',''), nullif(w->>'link',''), w->>'name', '')))
$function$;

-- RPC: el editor (creator) mueve su tarjeta entre "Por hacer" y "En revisión"
-- y/o actualiza sus archivos, sin poder tocar el resto.
CREATE OR REPLACE FUNCTION public.produccion_creator_update(p_id text, p_estado text DEFAULT NULL::text, p_archivos jsonb DEFAULT NULL::jsonb, p_evento jsonb DEFAULT NULL::jsonb)
 RETURNS public.produccion_asignaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.produccion_asignaciones;
  actor_name text;
begin
  select * into r
  from public.produccion_asignaciones
  where id = p_id and creator_id = auth.uid();

  if not found then
    raise exception 'Tarjeta inexistente o no te pertenece';
  end if;

  if p_estado is not null then
    if p_estado not in ('porhacer', 'revision') then
      raise exception 'Un creator solo puede mover entre Por hacer y En revisión';
    end if;
    -- No permitir downgrade de una tarjeta ya aprobada/publicada.
    if r.estado in ('aprobado', 'publicado') then
      null; -- se ignora el cambio de estado
    elsif p_estado is distinct from r.estado then
      select display_name into actor_name from public.profiles where id = auth.uid();
      update public.produccion_asignaciones
        set estado = p_estado,
            historial = coalesce(historial, '[]'::jsonb) || jsonb_build_object(
              'ts',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'tipo',   'estado',
              'from',   r.estado,
              'to',     p_estado,
              'by',     auth.uid(),
              'byName', coalesce(nullif(actor_name, ''), 'Equipo')
            )
        where id = p_id;
    else
      update public.produccion_asignaciones set estado = p_estado where id = p_id;
    end if;
  end if;

  if p_archivos is not null then
    update public.produccion_asignaciones set archivos = p_archivos where id = p_id;
  end if;

  select * into r from public.produccion_asignaciones where id = p_id;
  return r;
end;
$function$;

-- RPC: merge atómico de archivos de una tarjeta (alta/reemplazo/baja) para
-- que dos personas subiendo a la vez no se pisen.
CREATE OR REPLACE FUNCTION public.produccion_merge_archivos(p_id text, p_up jsonb DEFAULT '[]'::jsonb, p_rm jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur jsonb;
  merged jsonb := '[]'::jsonb;
  f jsonb;
  k text;
  up_map jsonb := '{}'::jsonb;
  up_orden text[] := '{}';
  rm_keys text[] := '{}';
begin
  select archivos into cur
  from public.produccion_asignaciones
  where id = p_id and (owner_id = auth.uid() or creator_id = auth.uid())
  for update;
  if not found then
    raise exception 'Tarjeta inexistente o no te pertenece';
  end if;
  if cur is null or jsonb_typeof(cur) is distinct from 'array' then
    cur := '[]'::jsonb;
  end if;

  select coalesce(array_agg(value #>> '{}'), '{}') into rm_keys
  from jsonb_array_elements(coalesce(p_rm, '[]'::jsonb));

  for f in select * from jsonb_array_elements(coalesce(p_up, '[]'::jsonb)) loop
    k := coalesce(nullif(f->>'_replaces',''), public._archivo_key(f));
    if k is not null then
      up_map := up_map || jsonb_build_object(k, f - '_replaces');
      up_orden := up_orden || k;
    end if;
  end loop;

  for f in select * from jsonb_array_elements(cur) loop
    k := public._archivo_key(f);
    if k is not null and k = any(rm_keys) then continue; end if;
    if k is not null and up_map ? k then
      merged := merged || jsonb_build_array(up_map->k);
      up_map := up_map - k;
    else
      merged := merged || jsonb_build_array(f);
    end if;
  end loop;
  foreach k in array up_orden loop
    if (up_map ? k) and not (k = any(rm_keys)) then
      merged := merged || jsonb_build_array(up_map->k);
      up_map := up_map - k;
    end if;
  end loop;

  update public.produccion_asignaciones
     set archivos = merged, updated_at = now()
   where id = p_id;
  return merged;
end;
$function$;

-- RPC: agrega/quita winners en todas las tarjetas de un producto (dedupe por
-- _winner_key). p_owner solo lo puede pasar el server (service_role).
CREATE OR REPLACE FUNCTION public.produccion_winners_apply(p_producto_id text DEFAULT NULL::text, p_producto_nombre text DEFAULT NULL::text, p_add jsonb DEFAULT '[]'::jsonb, p_remove jsonb DEFAULT '[]'::jsonb, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  es_server boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
  v_owner uuid;
  ids text[] := '{}';
  existentes jsonb := '[]'::jsonb;
  nuevos jsonb := '[]'::jsonb;
  merged jsonb;
  seen text[] := '{}';
  rm text[] := '{}';
  r record;
  w jsonb;
  k text;
begin
  if p_owner is not null and p_owner is distinct from auth.uid() and not es_server then
    raise exception 'p_owner es solo para el server';
  end if;
  v_owner := coalesce(p_owner, auth.uid());
  if v_owner is null then
    raise exception 'Sin dueño';
  end if;

  select coalesce(array_agg(lower(trim(value #>> '{}'))), '{}') into rm
  from jsonb_array_elements(coalesce(p_remove, '[]'::jsonb));

  for r in
    select id, winners
    from public.produccion_asignaciones
    where owner_id = v_owner
      and (case when p_producto_id is not null
                then producto_id::text = p_producto_id
                else lower(trim(coalesce(producto_nombre,''))) = lower(trim(coalesce(p_producto_nombre,'')))
           end)
    order by updated_at desc nulls last
    for update
  loop
    ids := ids || r.id;
    if jsonb_typeof(r.winners) = 'array' then
      for w in select * from jsonb_array_elements(r.winners) loop
        k := public._winner_key(w);
        if k <> '' and not (k = any(seen)) then
          seen := seen || k;
          existentes := existentes || jsonb_build_array(w);
        end if;
      end loop;
    end if;
  end loop;

  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'Sin tarjetas de ese producto';
  end if;

  for w in select * from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) loop
    k := public._winner_key(w);
    if k is null or k = '' or k = any(rm) then continue; end if;
    if k = any(seen) then
      select coalesce(jsonb_agg(
        case when public._winner_key(t.e) = k
             then t.e || jsonb_strip_nulls(jsonb_build_object(
                    'link',    case when coalesce(t.e->>'link','')    = '' then w->'link'    end,
                    'driveId', case when coalesce(t.e->>'driveId','') = '' then w->'driveId' end))
             else t.e end), '[]'::jsonb)
      into existentes
      from jsonb_array_elements(existentes) as t(e);
    else
      seen := seen || k;
      nuevos := nuevos || jsonb_build_array(w);
    end if;
  end loop;

  merged := nuevos || existentes;
  select coalesce(jsonb_agg(t.e), '[]'::jsonb) into merged
  from jsonb_array_elements(merged) as t(e)
  where not (public._winner_key(t.e) = any(rm));

  update public.produccion_asignaciones
     set winners = merged, updated_at = now()
   where id = any(ids) and winners is distinct from merged;

  return merged;
end;
$function$;

-- RPC: búsqueda full-text de anuncios del usuario, con ranking y paginado.
CREATE OR REPLACE FUNCTION public.search_ads_ranked(q text, filter_producto text DEFAULT NULL::text, filter_competidor text DEFAULT NULL::text, filter_only_winners boolean DEFAULT false, page_offset integer DEFAULT 0, page_size integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, producto_id text, competidor_id text, ad_id text, page_name text, page_id text, headline text, body text, ocr_text text, transcript text, formato text, days_running integer, is_winner boolean, winner_tier text, score numeric, variantes integer, platforms text[], is_multiplatform boolean, image_url text, video_url text, snapshot_url text, start_date timestamp with time zone, scraped_at timestamp with time zone, rank real, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ts_q tsquery;
  total bigint;
begin
  ts_q := websearch_to_tsquery('spanish', coalesce(q, ''));

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
end $function$;


-- =============================================================================
-- 3. TRIGGERS
-- =============================================================================

CREATE TRIGGER trg_touch_meta_connections BEFORE UPDATE ON public.meta_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_productos BEFORE UPDATE ON public.marketing_productos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_imagenes BEFORE UPDATE ON public.producto_imagenes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_brands BEFORE UPDATE ON public.marketing_brands FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER marketing_ads_search_vector_trigger BEFORE INSERT OR UPDATE ON public.marketing_ads FOR EACH ROW EXECUTE FUNCTION public.marketing_ads_update_search_vector();
CREATE TRIGGER trg_touch_inspiracion_global BEFORE UPDATE ON public.marketing_inspiracion_global FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_creativos BEFORE UPDATE ON public.marketing_creativos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_ideas BEFORE UPDATE ON public.marketing_ideas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_prefs BEFORE UPDATE ON public.marketing_prefs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_copilot_chats BEFORE UPDATE ON public.marketing_copilot_chats FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER produccion_asig_touch BEFORE UPDATE ON public.produccion_asignaciones FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER produccion_pagos_touch BEFORE UPDATE ON public.produccion_pagos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =============================================================================
-- 4. RLS Y POLÍTICAS
-- =============================================================================
-- Todas las tablas tienen RLS activado (ninguna con FORCE). Las que no tienen
-- políticas (integration_health, meta_connections, google_oauth,
-- auto_winners_config, auto_winners_owner_config) quedan cerradas para el
-- front: solo las toca el backend con la service role.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuenta_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creditos_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uso_secciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_imagenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_inspiracion_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_creativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_referencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_copilot_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_board_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testeos_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testeos_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_winners_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_winners_owner_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produccion_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produccion_jerarquia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produccion_notif_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produccion_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produccion_pago_config ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));
CREATE POLICY profiles_no_escalar ON public.profiles AS RESTRICTIVE FOR UPDATE TO public
  USING (true)
  WITH CHECK (((NOT (is_owner IS DISTINCT FROM ( SELECT p.is_owner
   FROM profiles p
  WHERE (p.id = profiles.id)))) AND ((COALESCE(role, 'user'::text) = COALESCE(( SELECT p.role
   FROM profiles p
  WHERE (p.id = profiles.id)), 'user'::text)) OR ((COALESCE(role, 'user'::text) <> ALL (ARRAY['admin'::text, 'rrhh'::text, 'supervisor'::text, 'coordinador'::text, 'empleado'::text])) AND (COALESCE(( SELECT p.role
   FROM profiles p
  WHERE (p.id = profiles.id)), 'user'::text) <> ALL (ARRAY['admin'::text, 'rrhh'::text, 'supervisor'::text, 'coordinador'::text, 'empleado'::text]))))));
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY profiles_self_update ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id))
  WITH CHECK (((auth.uid() = id) AND (role = ( SELECT p.role
   FROM profiles p
  WHERE (p.id = auth.uid())))));

-- cuenta_miembros
CREATE POLICY cm_member_read ON public.cuenta_miembros AS PERMISSIVE FOR SELECT TO public
  USING ((member_id = auth.uid()));
CREATE POLICY cm_owner_all ON public.cuenta_miembros AS PERMISSIVE FOR ALL TO public
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- suscripciones / creditos_eventos (solo lectura propia; escribe el backend)
CREATE POLICY suscripciones_select_own ON public.suscripciones AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY creditos_eventos_select_own ON public.creditos_eventos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));

-- user_prefs
CREATE POLICY user_prefs_self_all ON public.user_prefs AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- uso_secciones
CREATE POLICY "uso insert propio" ON public.uso_secciones AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "uso select propio" ON public.uso_secciones AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

-- marketing_productos
CREATE POLICY mk_productos_miembro_all ON public.marketing_productos AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));
CREATE POLICY mk_productos_miembro_sel ON public.marketing_productos AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = miembro_owner(NULL::text)));
CREATE POLICY productos_self_all ON public.marketing_productos AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- producto_imagenes
CREATE POLICY imagenes_self_all ON public.producto_imagenes AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY prod_imagenes_miembro_all ON public.producto_imagenes AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));

-- marketing_brands
CREATE POLICY brands_self_all ON public.marketing_brands AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mk_brands_miembro_all ON public.marketing_brands AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));

-- marketing_ads
CREATE POLICY marketing_ads_self_all ON public.marketing_ads AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mk_ads_miembro_all ON public.marketing_ads AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));

-- marketing_inspiracion_global
CREATE POLICY inspiracion_global_self_all ON public.marketing_inspiracion_global AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- marketing_creativos
CREATE POLICY creativos_self_all ON public.marketing_creativos AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mk_creativos_miembro_all ON public.marketing_creativos AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));

-- marketing_ideas
CREATE POLICY ideas_self_all ON public.marketing_ideas AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mk_ideas_miembro_all ON public.marketing_ideas AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));

-- marketing_referencias
CREATE POLICY mk_referencias_miembro_all ON public.marketing_referencias AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('productos'::text)))
  WITH CHECK ((user_id = miembro_owner('productos'::text)));
CREATE POLICY referencias_self_all ON public.marketing_referencias AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- marketing_costs
CREATE POLICY marketing_costs_self_insert ON public.marketing_costs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY marketing_costs_self_select ON public.marketing_costs AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

-- marketing_prefs
CREATE POLICY prefs_self_all ON public.marketing_prefs AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- marketing_copilot_chats
CREATE POLICY copilot_chats_self_all ON public.marketing_copilot_chats AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- marketing_boards / marketing_board_items
CREATE POLICY boards_self_all ON public.marketing_boards AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY board_items_self_all ON public.marketing_board_items AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- marketing_publicaciones (solo lectura propia; escribe el backend)
CREATE POLICY "publicaciones self select" ON public.marketing_publicaciones AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

-- testeos
CREATE POLICY testeos_cfg_miembro_all ON public.testeos_config AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('metricas'::text)))
  WITH CHECK ((user_id = miembro_owner('metricas'::text)));
CREATE POLICY testeos_config_self_all ON public.testeos_config AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY testeos_snap_miembro_all ON public.testeos_snapshots AS PERMISSIVE FOR ALL TO public
  USING ((user_id = miembro_owner('metricas'::text)))
  WITH CHECK ((user_id = miembro_owner('metricas'::text)));
CREATE POLICY testeos_snapshots_self_all ON public.testeos_snapshots AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- landings
CREATE POLICY landings_delete ON public.landings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((owner_id = auth.uid()));
CREATE POLICY landings_insert ON public.landings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY landings_miembro_all ON public.landings AS PERMISSIVE FOR ALL TO public
  USING ((owner_id = miembro_owner('landings'::text)))
  WITH CHECK ((owner_id = miembro_owner('landings'::text)));
CREATE POLICY landings_select ON public.landings AS PERMISSIVE FOR SELECT TO authenticated
  USING (((owner_id = auth.uid()) OR (creator_id = auth.uid())));
CREATE POLICY landings_update ON public.landings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- produccion_asignaciones
CREATE POLICY prod_asig_miembro_all ON public.produccion_asignaciones AS PERMISSIVE FOR ALL TO public
  USING ((owner_id = miembro_owner('produccion'::text)))
  WITH CHECK ((owner_id = miembro_owner('produccion'::text)));
CREATE POLICY produccion_asig_delete ON public.produccion_asignaciones AS PERMISSIVE FOR DELETE TO authenticated
  USING ((owner_id = auth.uid()));
CREATE POLICY produccion_asig_insert ON public.produccion_asignaciones AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY produccion_asig_select ON public.produccion_asignaciones AS PERMISSIVE FOR SELECT TO authenticated
  USING (((owner_id = auth.uid()) OR (creator_id = auth.uid()) OR produccion_lidera(owner_id, creator_id)));
CREATE POLICY produccion_asig_update ON public.produccion_asignaciones AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- produccion_jerarquia
CREATE POLICY produccion_jerarquia_select ON public.produccion_jerarquia AS PERMISSIVE FOR SELECT TO authenticated
  USING (((owner_id = auth.uid()) OR (lider_id = auth.uid()) OR (creator_id = auth.uid())));
CREATE POLICY produccion_jerarquia_write ON public.produccion_jerarquia AS PERMISSIVE FOR ALL TO authenticated
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- produccion_notif_config
CREATE POLICY produccion_notif_config_all ON public.produccion_notif_config AS PERMISSIVE FOR ALL TO public
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- produccion_pagos
CREATE POLICY produccion_pagos_all ON public.produccion_pagos AS PERMISSIVE FOR ALL TO authenticated
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- produccion_pago_config
CREATE POLICY pago_config_all ON public.produccion_pago_config AS PERMISSIVE FOR ALL TO authenticated
  USING (((owner_id = auth.uid()) OR (creator_id = auth.uid())))
  WITH CHECK ((owner_id = auth.uid()));


-- =============================================================================
-- 5. STORAGE — bucket `creativos`
-- =============================================================================
-- Bucket público (lectura por URL pública), sin límite de tamaño ni de tipo.
-- Guarda: estáticos generados, miniaturas, fotos de producto
-- (producto-fotos/<owner>/...) y videos/miniaturas de referencias de Instagram.
-- Ruta: <owner_id>/... o producto-fotos/<owner_id>/...

INSERT INTO storage.buckets (id, name, public) VALUES ('creativos', 'creativos', true);

CREATE POLICY creativos_user_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'creativos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'producto-fotos'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)))));
CREATE POLICY creativos_user_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'creativos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'producto-fotos'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)))));
CREATE POLICY creativos_user_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'creativos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'producto-fotos'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)))));
CREATE POLICY creativos_user_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'creativos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'producto-fotos'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)))));
CREATE POLICY creativos_miembro_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'creativos'::text) AND (public.miembro_owner() IS NOT NULL) AND (((storage.foldername(name))[1] = (public.miembro_owner())::text) OR (((storage.foldername(name))[1] = 'producto-fotos'::text) AND ((storage.foldername(name))[2] = (public.miembro_owner())::text)))));


-- =============================================================================
-- 6. REALTIME
-- =============================================================================
-- Tablas que el front escucha en vivo (sincronización entre pestañas y miembros).

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.marketing_productos,
  public.marketing_brands,
  public.marketing_prefs,
  public.marketing_creativos,
  public.marketing_ideas,
  public.marketing_inspiracion_global,
  public.marketing_ads,
  public.marketing_boards,
  public.marketing_board_items,
  public.produccion_asignaciones,
  public.produccion_pagos,
  public.produccion_pago_config,
  public.landings;
