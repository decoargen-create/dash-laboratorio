-- Preferencias de usuario GLOBALES (no atadas a Marketing): apariencia
-- (color de acento, fuente, tamaño) y cualquier preferencia futura de la
-- plataforma. Una fila por usuario, payload libre en jsonb.
--
-- Multi-tenant: RLS sobre auth.uid() — cada user ve y escribe solo lo suyo.
-- Esto es el primer paso para que TODO sea cloud-first: hoy la apariencia
-- vivía solo en localStorage y por eso difería entre dispositivos.

create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

-- CRUD completo solo sobre la propia fila.
create policy "user_prefs_self_all" on public.user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
