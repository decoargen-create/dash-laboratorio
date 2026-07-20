-- Costos server-side — captura el gasto que NO pasa por el cliente
-- (principalmente el cron diario de scrape, que corre a las 6AM sin
-- browser). El cliente mergea estas filas con su log local (localStorage)
-- en el resumen de costos por producto.
--
-- El cron inserta con service role (bypasea RLS). El cliente solo LEE
-- sus propias filas.

create table if not exists public.marketing_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text,
  competidor_id text,
  auto_tipo text not null,           -- 'apify' | 'anthropic' | 'openai' | 'meta'
  amount numeric not null,           -- USD
  descripcion text,
  kind text default 'scrape',        -- 'scrape' | 'análisis' | ...
  source text not null default 'cron', -- 'cron' | 'server'
  created_at timestamptz not null default now()
);

create index if not exists marketing_costs_user_producto_idx
  on public.marketing_costs (user_id, producto_id, created_at desc);

alter table public.marketing_costs enable row level security;

drop policy if exists "marketing_costs_self_select" on public.marketing_costs;
create policy "marketing_costs_self_select" on public.marketing_costs
  for select using (auth.uid() = user_id);
-- Sin policy de INSERT/UPDATE/DELETE para authenticated: solo el service
-- role (cron) escribe.
