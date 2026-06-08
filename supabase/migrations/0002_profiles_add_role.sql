-- Migration 0002 — agregar columna `role` a public.profiles
--
-- Contexto: la migración 0001 definió `profiles.role text default 'user'`
-- pero la tabla ya preexistía con un esquema distinto (de un proyecto
-- anterior). El `create table if not exists` hizo que el bloque profiles
-- de 0001 sea no-op → la columna `role` nunca se agregó.
--
-- Esta migración la suma de forma idempotente. Una vez aplicada, el
-- esquema de profiles queda alineado con lo que 0001 prometió.

alter table public.profiles add column if not exists role text default 'user';

-- Backfill explícito para filas existentes que tengan NULL.
update public.profiles set role = 'user' where role is null;

-- Verificación: cuántas filas tienen role seteado
do $$
declare
  total int;
  con_role int;
begin
  select count(*) into total from public.profiles;
  select count(*) into con_role from public.profiles where role is not null;
  raise notice 'profiles total: %, con role: %', total, con_role;
end $$;
