-- Migration 0033 — Salud del Drive (para avisar cuando se desconecta)
--
-- Cuando el permiso de Google vence/revocan (típico con la app en "Testing",
-- 7 días) el Drive deja de funcionar y las subidas fallan EN SILENCIO hasta que
-- alguien lo nota. Ahora avisamos por mail + Discord al detectarlo.
--
-- Para no spamear guardamos el estado de salud acá mismo, junto a la conexión:
--   drive_down      → true si ya avisamos que está caído (edge-trigger).
--   drive_alert_at  → cuándo fue el último aviso (cooldown de 6h).
-- Solo el server (service-role) las toca, igual que el resto de la tabla.

alter table public.google_oauth
  add column if not exists drive_down     boolean not null default false,
  add column if not exists drive_alert_at timestamptz;
