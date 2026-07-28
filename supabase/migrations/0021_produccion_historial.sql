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
    update public.produccion_asignaciones set estado = p_estado where id = p_id;
  end if;

  if p_archivos is not null then
    update public.produccion_asignaciones set archivos = p_archivos where id = p_id;
  end if;

  -- Appendea el evento (no reescribe todo el historial).
  if p_evento is not null then
    update public.produccion_asignaciones
      set historial = coalesce(historial, '[]'::jsonb) || p_evento
      where id = p_id;
  end if;

  select * into r from public.produccion_asignaciones where id = p_id;
  return r;
end;
$$;

revoke all on function public.produccion_creator_update(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.produccion_creator_update(text, text, jsonb, jsonb) to authenticated;
