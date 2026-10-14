-- Tanda B2 de la auditoría de sincronización de Producción (lado servidor).
--
-- 1) produccion_merge_archivos — merge POR DELTA de la lista de archivos de una
--    tarjeta (upserts por ts + bajas por ts), con lock de fila. Antes, admin y
--    editor empujaban la LISTA ENTERA desde su cache: dos sesiones subiendo o
--    aprobando a la vez se pisaban archivos (hallazgo #2 de la auditoría).
-- 2) produccion_winners_apply — merge atómico de los winners de UN producto,
--    replicado en todas sus tarjetas EN el server. La usan el marcado manual
--    (cliente, con auth.uid()) y el cron de auto-winners (service-role, con
--    p_owner explícito). Antes el cron computaba el array final con filas
--    leídas minutos antes y pisaba marcados manuales (hallazgo #3).
-- 3) auto_winners_owner_config — la config de winners automáticos deja de ser
--    un singleton global y pasa a ser POR DUEÑO (hallazgo #6, multi-tenant).
--    La fila legacy (id=1) se migra al dueño con más tarjetas de Producción.

-- Clave de identidad de un archivo dentro de `archivos`: su ts (fallback
-- driveId / name para entradas viejas sin ts).
create or replace function public._archivo_key(f jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(f->>'ts',''), nullif(f->>'driveId',''), f->>'name')
$$;

-- Clave de identidad de un winner (el mismo criterio que el cliente y el cron):
-- driveId > link > name, lowercased.
create or replace function public._winner_key(w jsonb) returns text
language sql immutable as $$
  select lower(trim(coalesce(nullif(w->>'driveId',''), nullif(w->>'link',''), w->>'name', '')))
$$;

-- ── 1) Merge por delta de archivos ──────────────────────────────────────────
-- p_up: archivos a upsertear. Uno que trae `_replaces: <ts viejo>` reemplaza
--       EN SU LUGAR al archivo con esa clave (flujo "Reemplazar": el video
--       conserva su número en la lista). El marcador no se persiste.
-- p_rm: claves (ts) a borrar.
-- Autoriza al dueño o al editor de la tarjeta. Devuelve la lista final.
create or replace function public.produccion_merge_archivos(
  p_id text,
  p_up jsonb default '[]'::jsonb,
  p_rm jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur jsonb;
  merged jsonb := '[]'::jsonb;
  f jsonb;
  k text;
  up_map jsonb := '{}'::jsonb;   -- clave → archivo nuevo (upsert / replace-in-place)
  up_orden text[] := '{}';       -- claves de p_up en orden (para appendear los nuevos)
  rm_keys text[] := '{}';
begin
  select archivos into cur
  from public.produccion_asignaciones
  where id = p_id and (owner_id = auth.uid() or creator_id = auth.uid())
  for update;
  if not found then
    raise exception 'Tarjeta inexistente o no te pertenece';
  end if;
  if cur is null or jsonb_typeof(cur) is distinct from 'array' then
    cur := '[]'::jsonb;
  end if;

  select coalesce(array_agg(value #>> '{}'), '{}') into rm_keys
  from jsonb_array_elements(coalesce(p_rm, '[]'::jsonb));

  for f in select * from jsonb_array_elements(coalesce(p_up, '[]'::jsonb)) loop
    -- un replace-in-place se indexa por la clave del archivo VIEJO
    k := coalesce(nullif(f->>'_replaces',''), public._archivo_key(f));
    if k is not null then
      up_map := up_map || jsonb_build_object(k, f - '_replaces');
      up_orden := up_orden || k;
    end if;
  end loop;

  -- existentes: saco los de p_rm, piso con la versión de p_up si vino
  for f in select * from jsonb_array_elements(cur) loop
    k := public._archivo_key(f);
    if k is not null and k = any(rm_keys) then continue; end if;
    if k is not null and up_map ? k then
      merged := merged || jsonb_build_array(up_map->k);
      up_map := up_map - k;
    else
      merged := merged || jsonb_build_array(f);
    end if;
  end loop;
  -- nuevos (los de p_up que no estaban): al final, en el orden en que vinieron
  foreach k in array up_orden loop
    if (up_map ? k) and not (k = any(rm_keys)) then
      merged := merged || jsonb_build_array(up_map->k);
      up_map := up_map - k;
    end if;
  end loop;

  update public.produccion_asignaciones
     set archivos = merged, updated_at = now()
   where id = p_id;
  return merged;
end;
$$;

revoke all on function public.produccion_merge_archivos(text, jsonb, jsonb) from public, anon;
grant execute on function public.produccion_merge_archivos(text, jsonb, jsonb) to authenticated;

-- ── 2) Merge atómico de winners por producto ────────────────────────────────
-- p_add: winners a agregar (upsert por clave: uno existente se ENRIQUECE —
--        se le completan link/driveId si le faltaban —, uno nuevo va adelante).
-- p_remove: claves a desmarcar.
-- p_owner: SOLO para el server (service-role). Un cliente usa su auth.uid().
-- Re-lee los winners actuales de todas las tarjetas del producto CON LOCK,
-- mergea, y escribe el resultado en las que cambian. Devuelve la lista final.
create or replace function public.produccion_winners_apply(
  p_producto_id text default null,
  p_producto_nombre text default null,
  p_add jsonb default '[]'::jsonb,
  p_remove jsonb default '[]'::jsonb,
  p_owner uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  es_server boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
  v_owner uuid;
  ids text[] := '{}';
  existentes jsonb := '[]'::jsonb;
  nuevos jsonb := '[]'::jsonb;
  merged jsonb;
  seen text[] := '{}';
  rm text[] := '{}';
  r record;
  w jsonb;
  k text;
begin
  if p_owner is not null and p_owner is distinct from auth.uid() and not es_server then
    raise exception 'p_owner es solo para el server';
  end if;
  v_owner := coalesce(p_owner, auth.uid());
  if v_owner is null then
    raise exception 'Sin dueño';
  end if;

  select coalesce(array_agg(lower(trim(value #>> '{}'))), '{}') into rm
  from jsonb_array_elements(coalesce(p_remove, '[]'::jsonb));

  -- Tarjetas del producto (del dueño), más nuevas primero: la primera aparición
  -- de cada clave gana — el mismo criterio que el cliente y el cron.
  for r in
    select id, winners
    from public.produccion_asignaciones
    where owner_id = v_owner
      and (case when p_producto_id is not null
                then producto_id::text = p_producto_id
                else lower(trim(coalesce(producto_nombre,''))) = lower(trim(coalesce(p_producto_nombre,'')))
           end)
    order by updated_at desc nulls last
    for update
  loop
    ids := ids || r.id;
    if jsonb_typeof(r.winners) = 'array' then
      for w in select * from jsonb_array_elements(r.winners) loop
        k := public._winner_key(w);
        if k <> '' and not (k = any(seen)) then
          seen := seen || k;
          existentes := existentes || jsonb_build_array(w);
        end if;
      end loop;
    end if;
  end loop;

  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'Sin tarjetas de ese producto';
  end if;

  -- upserts: existente → enriquecer link/driveId faltantes; nuevo → adelante
  for w in select * from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) loop
    k := public._winner_key(w);
    if k is null or k = '' or k = any(rm) then continue; end if;
    if k = any(seen) then
      select coalesce(jsonb_agg(
        case when public._winner_key(t.e) = k
             then t.e || jsonb_strip_nulls(jsonb_build_object(
                    'link',    case when coalesce(t.e->>'link','')    = '' then w->'link'    end,
                    'driveId', case when coalesce(t.e->>'driveId','') = '' then w->'driveId' end))
             else t.e end), '[]'::jsonb)
      into existentes
      from jsonb_array_elements(existentes) as t(e);
    else
      seen := seen || k;
      nuevos := nuevos || jsonb_build_array(w);
    end if;
  end loop;

  merged := nuevos || existentes;
  -- bajas
  select coalesce(jsonb_agg(t.e), '[]'::jsonb) into merged
  from jsonb_array_elements(merged) as t(e)
  where not (public._winner_key(t.e) = any(rm));

  update public.produccion_asignaciones
     set winners = merged, updated_at = now()
   where id = any(ids) and winners is distinct from merged;

  return merged;
end;
$$;

revoke all on function public.produccion_winners_apply(text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.produccion_winners_apply(text, text, jsonb, jsonb, uuid) to authenticated;

-- ── 3) Config de winners automáticos POR DUEÑO ──────────────────────────────
create table if not exists public.auto_winners_owner_config (
  owner_id      uuid primary key references auth.users(id) on delete cascade,
  enabled       boolean not null default true,
  account_ids   text[] not null default '{}',
  ventana_dias  int not null default 7,
  min_compras   int not null default 6,
  min_roas      numeric not null default 2.5,
  top_min       int not null default 3,
  updated_at    timestamptz not null default now()
);

-- RLS encendida sin policies: solo el server (service-role) la lee/escribe.
alter table public.auto_winners_owner_config enable row level security;

-- Backfill: la fila global legacy pasa al dueño con más tarjetas de Producción
-- (el único inquilino real hasta ahora). La tabla vieja queda como está.
insert into public.auto_winners_owner_config
  (owner_id, enabled, account_ids, ventana_dias, min_compras, min_roas, top_min)
select o.owner_id, c.enabled, c.account_ids, c.ventana_dias, c.min_compras, c.min_roas, c.top_min
from public.auto_winners_config c
cross join lateral (
  select owner_id
  from public.produccion_asignaciones
  where owner_id is not null
  group by owner_id
  order by count(*) desc
  limit 1
) o
where c.id = 1
on conflict (owner_id) do nothing;
