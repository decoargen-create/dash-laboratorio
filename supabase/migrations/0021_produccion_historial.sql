-- Migration 0021 — HISTORIAL por tarjeta de Producción (para KPIs de tiempos)
--
-- Suma una columna `historial` (jsonb) a produccion_asignaciones: una lista de
-- eventos { ts, tipo, by, byName, from?, to? } que registra la creación de la
-- tarjeta y cada cambio de estado (y quién lo hizo). Sirve para medir tiempos
-- de entrega y eficiencia del equipo.
--
-- El admin escribe el historial directo (dentro del upsert de la fila). El
-- creator lo hace vía la RPC produccion_creator_update, que ahora acepta un
-- p_evento y lo APPENDEA server-side (no puede reescribir el historial entero
-- — evita manipulación).
--
-- Nota: el frontend detecta si esta columna existe antes de mandar historial a
-- la nube, así que es seguro aplicarla en cualquier momento.

alter table public.produccion_asignaciones
  add column if not exists historial jsonb not null default '[]'::jsonb;

-- Reemplazamos la RPC para sumar p_evento. Drop + create porque cambia la firma.
drop function if exists public.produccion_creator_update(text, text, jsonb);

-- p_evento se mantiene por compatibilidad de firma pero NO se confía: el evento
-- de historial se construye SERVER-SIDE con auth.uid()/now(), así un creator no
-- puede falsificar quién/cuándo hizo el cambio.
create or replace function public.produccion_creator_update(
  p_id       text,
  p_estado   text  default null,
  p_archivos jsonb default null,
  p_evento   jsonb default null
)
returns public.produccion_asignaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.produccion_asignaciones;
  actor_name text;
begin
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
    -- Si el estado realmente cambia, registramos el evento (server-side).
    if p_estado is distinct from r.estado then
      select display_name into actor_name from public.profiles where id = auth.uid();
      update public.produccion_asignaciones
        set estado = p_estado,
            historial = coalesce(historial, '[]'::jsonb) || jsonb_build_object(
              'ts',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'tipo',   'estado',
              'from',   r.estado,
              'to',     p_estado,
              'by',     auth.uid(),
              'byName', coalesce(nullif(actor_name, ''), 'Equipo')
            )
        where id = p_id;
    else
      update public.produccion_asignaciones set estado = p_estado where id = p_id;
    end if;
  end if;

  if p_archivos is not null then
    update public.produccion_asignaciones set archivos = p_archivos where id = p_id;
  end if;

  select * into r from public.produccion_asignaciones where id = p_id;
  return r;
end;
$$;

revoke all on function public.produccion_creator_update(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.produccion_creator_update(text, text, jsonb, jsonb) to authenticated;
