-- ⭐ Winners automáticos: configuración de la corrida (criterio + cuentas).
-- Una sola fila (id=1). La lee/escribe solo el server (service-role);
-- RLS encendida sin policies = ningún cliente la toca directo.
create table if not exists public.auto_winners_config (
  id            int primary key default 1 check (id = 1),
  enabled       boolean not null default true,
  -- Cuentas publicitarias a escanear (ids numéricos, sin "act_"). Se aprende
  -- solo: cada corrida manual desde Métricas suma la cuenta elegida.
  account_ids   text[] not null default '{}',
  ventana_dias  int not null default 7,
  min_compras   int not null default 6,
  min_roas      numeric not null default 2.5,
  top_min       int not null default 3,
  updated_at    timestamptz not null default now()
);

alter table public.auto_winners_config enable row level security;

insert into public.auto_winners_config (id) values (1) on conflict (id) do nothing;
