-- Aislamiento por dueño (multi-inquilino) en Producción.
--
-- Antes la RLS de produccion_asignaciones / produccion_pagos era GLOBAL
-- (is_app_admin = profiles.role='admin'), pensada para "un solo lab". Pero la
-- base es compartida por varios negocios, así que un admin global podía ver el
-- tablero de otro. Y una cuenta dueña con role 'user' no podía escribir.
--
-- Este cambio agrega owner_id a cada fila y reemplaza las policies para que cada
-- cuenta vea/edite SOLO sus propias filas (owner_id = auth.uid()). Los editores
-- (creator) siguen viendo sus tarjetas asignadas (creator_id) y escriben por la
-- RPC produccion_creator_update (SECURITY DEFINER, no depende de estas policies).
--
-- Aplicado con tablas vacías → sin migración de datos. Idempotente.

-- 1) owner_id en asignaciones
alter table public.produccion_asignaciones
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists produccion_asig_owner_idx
  on public.produccion_asignaciones (owner_id);

-- 2) owner_id en pagos + PK con owner_id (dos dueños pueden pagar la misma
--    persona la misma semana). Tabla vacía → set not null + recrear PK es seguro.
alter table public.produccion_pagos
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.produccion_pagos
  alter column owner_id set not null;
alter table public.produccion_pagos
  drop constraint if exists produccion_pagos_pkey;
alter table public.produccion_pagos
  add constraint produccion_pagos_pkey primary key (owner_id, week_key, persona);

-- 3) RLS asignaciones: dueño (owner_id) o editor asignado (creator_id)
drop policy if exists produccion_asig_select on public.produccion_asignaciones;
create policy produccion_asig_select on public.produccion_asignaciones
  for select to authenticated
  using (owner_id = auth.uid() or creator_id = auth.uid());

drop policy if exists produccion_asig_insert on public.produccion_asignaciones;
create policy produccion_asig_insert on public.produccion_asignaciones
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists produccion_asig_update on public.produccion_asignaciones;
create policy produccion_asig_update on public.produccion_asignaciones
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists produccion_asig_delete on public.produccion_asignaciones;
create policy produccion_asig_delete on public.produccion_asignaciones
  for delete to authenticated
  using (owner_id = auth.uid());

-- 4) RLS pagos: solo el dueño
drop policy if exists produccion_pagos_all on public.produccion_pagos;
create policy produccion_pagos_all on public.produccion_pagos
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
