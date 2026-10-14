-- Migration 0040 — telemetría mínima de uso de la plataforma
--
-- "Estaría bueno ver cuáles son las cosas que no se usan realmente" (14/10).
-- Una fila por visita a cada sección (quién, qué sección, cuándo). Con esto
-- se decide con datos qué partes viven y cuáles se podan (como Winners viejo
-- y Copy AI, que salieron del menú).
create table if not exists public.uso_secciones (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid(),
  seccion  text not null,
  ts       timestamptz not null default now()
);

create index if not exists uso_secciones_seccion_ts on public.uso_secciones (seccion, ts);
create index if not exists uso_secciones_user_ts on public.uso_secciones (user_id, ts);

alter table public.uso_secciones enable row level security;

drop policy if exists "uso insert propio" on public.uso_secciones;
create policy "uso insert propio" on public.uso_secciones
  for insert with check (auth.uid() = user_id);

drop policy if exists "uso select propio" on public.uso_secciones;
create policy "uso select propio" on public.uso_secciones
  for select using (auth.uid() = user_id);
