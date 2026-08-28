-- Jerarquía del equipo de Producción: quién responde a quién (pedido del
-- dueño: "Poncio tiene a cargo a Tommy y a Wanda — cuando entra Poncio ve
-- sus productos más los de su gente; Wanda solo los suyos; yo veo todo").
--
-- Modelo: un LÍDER es un creator que tiene otros creators a cargo. La
-- relación vive por dueño (owner_id) porque la base es multi-negocio.
-- UN nivel de profundidad (líder → gente); sin recursión.
--
-- La visibilidad se resuelve acá abajo (RLS), no en el frontend: el SELECT
-- de produccion_asignaciones se extiende para que el líder vea las tarjetas
-- de su gente. El workspace del editor muestra lo que la RLS le devuelve,
-- así que el panel del líder se arma solo. ESCRIBIR sigue igual que antes:
-- la RPC produccion_creator_update exige creator_id = auth.uid(), o sea que
-- el líder VE las tarjetas de su gente pero no las edita (v1: solo lectura).
--
-- Idempotente.

create table if not exists public.produccion_jerarquia (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  lider_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, creator_id),
  -- nadie puede ser su propio líder
  constraint produccion_jerarquia_no_self check (creator_id <> lider_id)
);

create index if not exists produccion_jerarquia_lider_idx
  on public.produccion_jerarquia (lider_id);

alter table public.produccion_jerarquia enable row level security;

-- El dueño gestiona su organigrama; líder y liderado pueden LEER sus filas
-- (el líder necesita saber quién es su gente).
drop policy if exists produccion_jerarquia_select on public.produccion_jerarquia;
create policy produccion_jerarquia_select on public.produccion_jerarquia
  for select to authenticated
  using (owner_id = auth.uid() or lider_id = auth.uid() or creator_id = auth.uid());

drop policy if exists produccion_jerarquia_write on public.produccion_jerarquia;
create policy produccion_jerarquia_write on public.produccion_jerarquia
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Helper SECURITY DEFINER: ¿el usuario actual lidera a este creator (de este
-- dueño)? Va como función para que la policy de asignaciones no dependa de la
-- RLS de la tabla de jerarquía (evita sorpresas de anidamiento) y para que el
-- planner la pueda cachear por fila.
create or replace function public.produccion_lidera(p_owner uuid, p_creator uuid)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1 from public.produccion_jerarquia j
    where j.owner_id = p_owner
      and j.creator_id = p_creator
      and j.lider_id = auth.uid()
  );
$$;

revoke all on function public.produccion_lidera(uuid, uuid) from public;
grant execute on function public.produccion_lidera(uuid, uuid) to authenticated;

-- SELECT de asignaciones: dueño · editor asignado · o su LÍDER.
drop policy if exists produccion_asig_select on public.produccion_asignaciones;
create policy produccion_asig_select on public.produccion_asignaciones
  for select to authenticated
  using (
    owner_id = auth.uid()
    or creator_id = auth.uid()
    or public.produccion_lidera(owner_id, creator_id)
  );
