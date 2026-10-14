-- Suscripciones — esqueleto del sistema de pagos (planes del plan de monetización).
--
-- Modelo: una fila por cuenta dueña (user de Supabase Auth). Los planes y sus
-- límites viven en el server (api/billing.js), acá solo el estado comercial.
-- Sin fila = plan 'trial' implícito. El admin de plataforma asigna planes a
-- mano hasta que haya checkout (MercadoPago/Stripe), que escribirá acá mismo.
--
-- Créditos: los incluidos se renuevan por período y NO acumulan (modelo
-- AdCreative). Los packs comprados van a creditos_extra y también se limpian
-- al renovar. creditos_eventos es el ledger (auditoría de cada movimiento).

create table if not exists public.suscripciones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial'
    check (plan in ('trial', 'starter', 'pro', 'agencia', 'fundador')),
  estado text not null default 'activa'
    check (estado in ('activa', 'vencida', 'cancelada')),
  periodo_inicio timestamptz not null default now(),
  periodo_fin timestamptz,
  creditos_usados integer not null default 0,
  creditos_extra integer not null default 0,
  provider text,       -- 'manual' | 'mercadopago' | 'stripe' (cuando haya checkout)
  provider_ref text,   -- id de la suscripción en el proveedor
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creditos_eventos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,   -- negativo = consumo, positivo = pack/renovación/ajuste
  motivo text not null,     -- 'estatico' | 'analisis' | 'pack' | 'renovacion' | 'ajuste'
  ref text,                 -- id del creativo/análisis/pago asociado
  created_at timestamptz not null default now()
);
create index if not exists creditos_eventos_user_idx
  on public.creditos_eventos (user_id, created_at desc);

-- RLS: cada cuenta LEE lo suyo; TODAS las escrituras pasan por el server
-- (service role) — sin policies de insert/update/delete para authenticated.
alter table public.suscripciones enable row level security;
alter table public.creditos_eventos enable row level security;

drop policy if exists "suscripciones_select_own" on public.suscripciones;
create policy "suscripciones_select_own" on public.suscripciones
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "creditos_eventos_select_own" on public.creditos_eventos;
create policy "creditos_eventos_select_own" on public.creditos_eventos
  for select to authenticated using (auth.uid() = user_id);
