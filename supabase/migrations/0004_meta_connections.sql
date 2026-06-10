-- Migration 0004 — Conexiones a cuentas publicitarias de Meta.
--
-- Permite que un user guarde VARIAS conexiones (una por cuenta/cliente), cada
-- una con su propio access token. Pensado para el caso "conectar la cuenta
-- publicitaria de cualquier persona": el token define a qué cuentas se accede.
--
-- SEGURIDAD: el access_token es un secreto. Esta tabla tiene RLS habilitado
-- pero SIN policies para usuarios normales → ni la anon key ni un user logueado
-- pueden leerla/escribirla. TODO el acceso pasa por el backend con la
-- service_role key (que bypassea RLS) DESPUÉS de verificar el JWT del user.
-- Además el token se guarda cifrado (AES-256-GCM con clave derivada de
-- AUTH_SECRET) — ver api/marketing/_supabase-server.js.

create table if not exists public.meta_connections (
  id text not null,                       -- generado server-side (uuid)
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,                             -- nombre que le pone el user ("Cliente X")
  meta_user_id text,                      -- id del user de Meta dueño del token
  meta_user_name text,                    -- nombre display de ese user
  access_token text not null,             -- CIFRADO — nunca se expone al frontend
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists idx_meta_connections_user on public.meta_connections(user_id);

-- RLS sin policies: bloquea todo acceso vía anon/authenticated. Solo el backend
-- con service_role puede tocar esta tabla.
alter table public.meta_connections enable row level security;

-- touch_updated_at() ya existe (definida en 0001_marketing_init.sql).
drop trigger if exists trg_touch_meta_connections on public.meta_connections;
create trigger trg_touch_meta_connections before update on public.meta_connections
  for each row execute procedure public.touch_updated_at();
