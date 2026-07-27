-- Migration 0020 — PRODUCCIÓN en la nube + login del equipo (Fase 2)
--
-- Contexto: hasta ahora el tablero de Producción (asignaciones semanales
-- producto × persona, con estado y pago) vivía SOLO en localStorage
-- (produccionStore.js). Eso impedía que cada creativo ("chico") entrara desde
-- SU computadora y viera su tablero: localStorage es por-navegador.
--
-- Esta migración mueve el control a la base con RLS:
--   - produccion_asignaciones: las tarjetas del kanban. Cada una puede estar
--     asignada a un creator (creator_id → auth.users). Los admin ven TODO;
--     un creator ve SOLO sus tarjetas.
--   - produccion_pagos: el saldo semanal por persona. SOLO admin.
--
-- Permisos (RLS):
--   - admin (profiles.role='admin')  → CRUD completo.
--   - creator                        → SELECT solo de lo suyo; NO puede
--     insertar/borrar ni hacer UPDATE directo. Para cambiar estado o registrar
--     videos usa la RPC produccion_creator_update (estado limitado a
--     'porhacer'/'revision' — aprobar/publicar queda para el admin).
--
-- Multi-inquilino: la base es compartida con clientes del SaaS. Producción es
-- del lab: visible para cualquier admin del lab y para el creator asignado.
-- No se agrega columna de tenant porque el tablero es único (un solo lab).

-- =========================================================================
-- Helper: ¿el caller es admin del lab? SECURITY DEFINER para poder leer
-- profiles sin chocar con su propia RLS. STABLE (mismo resultado dentro de la
-- transacción) para que el planner lo cachee por fila.
-- =========================================================================
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- =========================================================================
-- Tabla: produccion_asignaciones (las tarjetas del kanban)
-- id es text porque lo genera el cliente ('prodasig-...') — así la migración
-- de la data local existente conserva los mismos ids (upsert sin duplicar).
-- =========================================================================
create table if not exists public.produccion_asignaciones (
  id               text primary key,
  week_key         text not null,
  producto_id      text,
  producto_nombre  text default '',
  persona          text default '',
  creator_id       uuid references auth.users(id) on delete set null,
  tipo             text not null default 'renovado',
  estado           text not null default 'porhacer',
  videos_total     integer not null default 9,
  videos_aprobados integer not null default 0,
  brief            text default '',
  nota             text default '',
  pagado           boolean not null default false,
  archivos         jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists produccion_asig_creator_idx on public.produccion_asignaciones (creator_id);
create index if not exists produccion_asig_week_idx    on public.produccion_asignaciones (week_key);

-- updated_at automático (reusa el helper de 0001).
drop trigger if exists produccion_asig_touch on public.produccion_asignaciones;
create trigger produccion_asig_touch
  before update on public.produccion_asignaciones
  for each row execute function public.touch_updated_at();

alter table public.produccion_asignaciones enable row level security;

-- SELECT: admin ve todo; creator ve solo lo suyo.
drop policy if exists produccion_asig_select on public.produccion_asignaciones;
create policy produccion_asig_select on public.produccion_asignaciones
  for select
  using (public.is_app_admin() or creator_id = auth.uid());

-- INSERT / UPDATE / DELETE directos: SOLO admin. El creator no tiene policy de
-- write → RLS se lo niega por defecto; usa la RPC de abajo.
drop policy if exists produccion_asig_insert on public.produccion_asignaciones;
create policy produccion_asig_insert on public.produccion_asignaciones
  for insert
  with check (public.is_app_admin());

drop policy if exists produccion_asig_update on public.produccion_asignaciones;
create policy produccion_asig_update on public.produccion_asignaciones
  for update
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists produccion_asig_delete on public.produccion_asignaciones;
create policy produccion_asig_delete on public.produccion_asignaciones
  for delete
  using (public.is_app_admin());

-- =========================================================================
-- Tabla: produccion_pagos (saldo semanal por persona) — SOLO admin.
-- =========================================================================
create table if not exists public.produccion_pagos (
  week_key   text not null,
  persona    text not null,
  paid       boolean not null default false,
  paid_at    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (week_key, persona)
);

drop trigger if exists produccion_pagos_touch on public.produccion_pagos;
create trigger produccion_pagos_touch
  before update on public.produccion_pagos
  for each row execute function public.touch_updated_at();

alter table public.produccion_pagos enable row level security;

drop policy if exists produccion_pagos_all on public.produccion_pagos;
create policy produccion_pagos_all on public.produccion_pagos
  for all
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- =========================================================================
-- RPC: produccion_creator_update
-- Único camino de escritura para un creator. Sólo puede tocar SU tarjeta y
-- SÓLO estado (limitado a 'porhacer'/'revision') y la lista de archivos
-- (videos que subió). No puede aprobar/publicar, reasignar, ni tocar pagos.
-- SECURITY DEFINER para poder escribir saltando la falta de policy de update
-- del creator, pero con el chequeo de dueño adentro.
-- =========================================================================
create or replace function public.produccion_creator_update(
  p_id       text,
  p_estado   text  default null,
  p_archivos jsonb default null
)
returns public.produccion_asignaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.produccion_asignaciones;
begin
  -- La tarjeta tiene que existir y ser del caller.
  select * into r
  from public.produccion_asignaciones
  where id = p_id and creator_id = auth.uid();

  if not found then
    raise exception 'Tarjeta inexistente o no te pertenece';
  end if;

  if p_estado is not null then
    if p_estado not in ('porhacer', 'revision') then
      raise exception 'Un creator solo puede mover entre Por hacer y En revisión';
    end if;
    update public.produccion_asignaciones
      set estado = p_estado
      where id = p_id;
  end if;

  if p_archivos is not null then
    update public.produccion_asignaciones
      set archivos = p_archivos
      where id = p_id;
  end if;

  select * into r from public.produccion_asignaciones where id = p_id;
  return r;
end;
$$;

-- Blindaje del rol `anon` (sin login): por los default privileges de Supabase
-- las funciones SECURITY DEFINER y las tablas quedan expuestas a anon salvo que
-- se revoque explícitamente. Producción es 100% autenticado.
revoke all on public.produccion_asignaciones from anon;
revoke all on public.produccion_pagos from anon;
revoke execute on function public.is_app_admin() from anon, public;
revoke execute on function public.produccion_creator_update(text, text, jsonb) from anon, public;
grant execute on function public.produccion_creator_update(text, text, jsonb) to authenticated;
grant execute on function public.is_app_admin() to authenticated;
