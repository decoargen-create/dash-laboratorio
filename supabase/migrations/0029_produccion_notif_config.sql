-- Producción — configuración de notificaciones de Discord por dueño.
--
-- Un solo canal de equipo (webhook = env var DISCORD_WEBHOOK_URL). Acá guardamos,
-- por dueño, QUÉ transiciones avisan y A QUIÉN @mencionar en cada una. El endpoint
-- /api/produccion/notify lee esta config (service-role) resolviendo el dueño por
-- la tarjeta; la app la edita (RLS: cada dueño ve/edita solo la suya).
--
-- config (jsonb) ej:
-- {
--   "estados": {
--     "revision":  { "on": true,  "mentions": "123456789012345678" },
--     "aprobado":  { "on": true,  "mentions": "123..., 456..." },
--     "publicado": { "on": false, "mentions": "" }
--   }
-- }
-- mentions = IDs de Discord separados por coma. Un id con prefijo "&" = rol.

create table if not exists public.produccion_notif_config (
  owner_id   uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.produccion_notif_config enable row level security;

drop policy if exists produccion_notif_config_all on public.produccion_notif_config;
create policy produccion_notif_config_all on public.produccion_notif_config
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
