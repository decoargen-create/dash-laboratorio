-- Migration 0023 — Saldo por persona + moneda, en la nube
--
-- Contexto: el "cargar saldo" por persona (Vito transfirió $90.000, etc.) y la
-- preferencia de moneda + tipo de cambio vivían SOLO en localStorage
-- (moneyStore.js). Eso los hacía por-navegador: si el dueño cargaba el saldo en
-- el celular, no aparecía en la compu (y se perdía al limpiar el navegador).
--
-- Esta tabla lo mueve a la nube, una fila por usuario (el dueño del lab), con un
-- blob JSON { currency, rate, people: { <persona>: [{amount,currency,ts}] } }.
-- RLS: cada quien ve/escribe SOLO su propia fila.

create table if not exists public.money_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- updated_at automático (reusa el helper de 0001).
drop trigger if exists money_settings_touch on public.money_settings;
create trigger money_settings_touch
  before update on public.money_settings
  for each row execute function public.touch_updated_at();

alter table public.money_settings enable row level security;

-- Cada usuario solo su propia fila (lectura y escritura).
drop policy if exists money_settings_rw on public.money_settings;
create policy money_settings_rw on public.money_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Blindaje anon (sin login) + grant explícito al rol autenticado.
revoke all on public.money_settings from anon;
grant select, insert, update, delete on public.money_settings to authenticated;
