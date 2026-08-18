-- Guard A2: el editor (creator) NO puede "bajar" una tarjeta ya aprobada o
-- publicada a Por hacer / En revisión vía la RPC. La UI ya lo esconde, pero la
-- RPC es la frontera de seguridad. Si la tarjeta está aprobada/publicada,
-- ignoramos el cambio de estado (los archivos igual se guardan). Ya aplicada.
create or replace function public.produccion_creator_update(
  p_id text,
  p_estado text default null,
  p_archivos jsonb default null,
  p_evento jsonb default null
)
returns produccion_asignaciones
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- No permitir downgrade de una tarjeta ya aprobada/publicada.
    if r.estado in ('aprobado', 'publicado') then
      null; -- se ignora el cambio de estado
    elsif p_estado is distinct from r.estado then
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
$function$;
