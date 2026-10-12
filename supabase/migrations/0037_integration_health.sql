-- Migration 0037 — salud de integraciones externas (Meta, y lo que venga)
--
-- Una fila por integración ('meta', ...) con el estado de salud para avisos:
--   down      → ya avisamos que está caída (edge-trigger, no spamear)
--   alert_at  → último aviso de caída (cooldown)
--   warned_at → último aviso PREVENTIVO de vencimiento (para avisar una sola
--               vez por token: se compara contra el updated_at de la conexión)
-- Solo el server (service-role) la toca — igual que google_oauth.

create table if not exists public.integration_health (
  integration text primary key,
  down        boolean not null default false,
  alert_at    timestamptz,
  warned_at   timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.integration_health enable row level security;
revoke all on public.integration_health from anon, authenticated;
