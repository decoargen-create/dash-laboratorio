-- =========================================================================
-- MARKETING_IDEAS — bandeja de ideas como filas individuales en lugar de
-- vivir dentro de producto.data.bandejaIdeas[].
--
-- Por qué: hoy las ideas se sincronizan empotradas en el producto JSON.
-- Eso da una race condition real cuando dos PCs agregan ideas en paralelo:
-- cada push manda el array entero, el último que pushea pisa lo del otro.
-- Y con merge naive (union por id) renacen ideas borradas en la otra PC.
-- La solución correcta es per-row: cada idea es una fila → INSERT / UPDATE
-- / DELETE atómicos, Realtime per row, sin overwrite del array.
--
-- Migración de datos:
--   No se migran en SQL. El cliente, al hacer el primer pull, detecta
--   ideas en producto.data.bandejaIdeas[], las upsertea acá y limpia el
--   array del producto. Idempotente (upsert por (user_id, id)).
-- =========================================================================

create table if not exists public.marketing_ideas (
  id text not null,                   -- client-generated (compat con bandejaStore)
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id text,                   -- nullable: ideas orphan (legacy sin productoId)
  data jsonb not null,                -- la idea completa (titulo, hook, copy, guion, etc.)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists idx_marketing_ideas_user on public.marketing_ideas(user_id);
create index if not exists idx_marketing_ideas_user_producto on public.marketing_ideas(user_id, producto_id);
create index if not exists idx_marketing_ideas_updated on public.marketing_ideas(updated_at desc);

-- RLS
alter table public.marketing_ideas enable row level security;
drop policy if exists "ideas_self_all" on public.marketing_ideas;
create policy "ideas_self_all" on public.marketing_ideas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Touch trigger
drop trigger if exists trg_touch_ideas on public.marketing_ideas;
create trigger trg_touch_ideas before update on public.marketing_ideas
  for each row execute procedure public.touch_updated_at();

-- Realtime — necesario para que cambios entre devices se vean en vivo.
-- REPLICA IDENTITY FULL para que el filter user_id=eq.X funcione en DELETE.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'marketing_ideas'
  ) then
    alter publication supabase_realtime add table public.marketing_ideas;
  end if;
end$$;

alter table public.marketing_ideas replica identity full;
