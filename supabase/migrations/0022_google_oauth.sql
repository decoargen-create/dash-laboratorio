-- Migration 0022 — Google OAuth para subir a Drive personal (@gmail)
--
-- La service account no tiene quota de storage, así que en un Drive personal
-- Google rechaza las subidas (403). Solución: el dueño del lab conecta su
-- cuenta de Google por OAuth una vez; guardamos su refresh_token (CIFRADO) y
-- con él subimos los videos COMO él, a su Drive de 15GB.
--
-- La tabla es 100% del server (service-role): el refresh_token nunca sale al
-- cliente. Sin políticas RLS → anon/authenticated no pueden leerla.

create table if not exists public.google_oauth (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  refresh_token text not null,   -- cifrado AES-256-GCM con AUTH_SECRET (prefijo v1:)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_oauth enable row level security;
-- Sin policies: solo el service-role (backend) accede. Blindamos anon/auth.
revoke all on public.google_oauth from anon, authenticated;
