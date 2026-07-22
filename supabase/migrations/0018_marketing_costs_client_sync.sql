-- Sincronización cloud de los costos registrados en el CLIENTE.
--
-- Problema que resuelve: los cost logs vivían solo en localStorage del
-- navegador donde corrió la operación. Si el user corre el pipeline en la
-- compu A y mira la lista de productos en la compu B, el gasto aparece $0.
--
-- Fix: el cliente ahora dual-escribe cada costo a marketing_costs con
-- source='client' y client_id = id del log local (para dedupe idempotente).

alter table public.marketing_costs
  add column if not exists client_id text;

-- Unique (user, client_id) → el upsert del cliente es idempotente aunque
-- se dispare dos veces (retry, doble tab). NULLs son distintos entre sí,
-- así que las filas viejas del cron (client_id null) no chocan.
create unique index if not exists marketing_costs_user_client_idx
  on public.marketing_costs (user_id, client_id);

-- El cliente puede INSERTAR sus propias filas (antes solo service role).
drop policy if exists "marketing_costs_self_insert" on public.marketing_costs;
create policy "marketing_costs_self_insert" on public.marketing_costs
  for insert with check (auth.uid() = user_id);
