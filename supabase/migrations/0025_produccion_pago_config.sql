-- Config de pago POR PERSONA (por dueño). Cada integrante puede tener su propio
-- monto por producto (9 videos) y sus propios tramos de bono semanal. Si una
-- persona no tiene fila acá, se usan los valores por defecto del código
-- (PAGO_POR_PRODUCTO + bonusObjetivo). Ya aplicada a la base; versionada acá.
create table if not exists public.produccion_pago_config (
  owner_id      uuid not null references auth.users(id) on delete cascade,
  persona       text not null,
  creator_id    uuid references auth.users(id) on delete set null, -- si la persona es una cuenta (para que el editor lea SU config)
  pago_producto integer not null default 42000,
  bonus_tramos  jsonb   not null default '[]'::jsonb,  -- [{ "min": 3, "monto": 24000 }, ...] (vacío = sin bono)
  updated_at    timestamptz not null default now(),
  primary key (owner_id, persona)
);

alter table public.produccion_pago_config enable row level security;

-- El dueño gestiona (lee/escribe) sus configs; el editor asignado solo LEE la
-- suya (para calcular su resumen), nunca la edita.
drop policy if exists pago_config_all on public.produccion_pago_config;
create policy pago_config_all on public.produccion_pago_config
  for all to authenticated
  using (owner_id = auth.uid() or creator_id = auth.uid())
  with check (owner_id = auth.uid());
