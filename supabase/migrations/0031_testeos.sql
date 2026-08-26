-- Testeos: reglas por tienda + fotos semanales de cada cohorte.
--
-- Dos tablas con propósitos muy distintos:
--
-- 1. testeos_config — la configuración de UNA cuenta publicitaria:
--    nomenclatura de testeos, umbrales y el ROAS de equilibrio de cada
--    producto. Vivía en localStorage y por eso no seguía al usuario entre
--    dispositivos ni sobrevivía a limpiar el navegador. Payload libre en
--    jsonb porque los campos van a seguir cambiando mientras afinamos las
--    reglas, y no quiero una migración por cada umbral nuevo.
--
-- 2. testeos_snapshots — la FOTO de una semana de testeos, congelada.
--    Meta atribuye compras hasta 7 días después del click, así que los
--    números de una cohorte siguen moviéndose durante días. Si el tablero
--    siempre consulta en vivo, el histórico se reescribe solo y nunca se
--    puede decir "la semana del 17/8 cerró en 32%". Cuando una semana
--    madura (pasaron los días de atribución) se guarda su foto y de ahí en
--    más ese número queda fijo.
--
-- Multi-tenant: RLS sobre auth.uid() en las dos. Cada dueño ve y escribe
-- solo lo suyo.

-- ── 1. Reglas por cuenta publicitaria ───────────────────────────────────
create table if not exists public.testeos_config (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,              -- act_XXXXXXXXX
  cfg jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id)
);

alter table public.testeos_config enable row level security;

drop policy if exists "testeos_config_self_all" on public.testeos_config;
create policy "testeos_config_self_all" on public.testeos_config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. Fotos semanales ──────────────────────────────────────────────────
-- Una fila por (cuenta, semana, producto). `producto_id` vacío = la foto de
-- toda la cuenta sin filtrar; así conviven el total y el corte por producto
-- sin pisarse.
create table if not exists public.testeos_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  semana date not null,                  -- lunes de la cohorte
  producto_id text not null default '',
  -- Lo que se congela: lanzadas, ganadoras, perdedoras, sin datos,
  -- eficiencia, totales de plata y los ids de las campañas.
  datos jsonb not null,
  -- Con qué reglas se sacó la foto. Sin esto, dentro de dos meses nadie
  -- podría explicar por qué la semana del 17/8 dio 50%: los umbrales
  -- pudieron haber cambiado.
  cfg jsonb not null default '{}'::jsonb,
  cerrada_at timestamptz not null default now(),
  primary key (user_id, account_id, semana, producto_id)
);

create index if not exists testeos_snapshots_cuenta_idx
  on public.testeos_snapshots (user_id, account_id, semana desc);

alter table public.testeos_snapshots enable row level security;

drop policy if exists "testeos_snapshots_self_all" on public.testeos_snapshots;
create policy "testeos_snapshots_self_all" on public.testeos_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
