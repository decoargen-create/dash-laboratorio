-- Producción — videos marcados como "winner" por producto, en la tarjeta.
--
-- Un winner es un creativo que vendió: se marca desde el buscador de videos y
-- queda como material de referencia para renovar/iterar ese producto. Igual que
-- material_link, se guarda en la tarjeta (no en el catálogo) y se copia a TODAS
-- las tarjetas del mismo producto, así el editor asignado lo ve en su tablero
-- (la RLS solo le deja leer sus propias tarjetas).
--
-- winners = jsonb array: [{ name, link, driveId, fecha, ts }]. Columna opcional
-- con feature-detection en el front (como material_link / historial): si la
-- migración todavía no se aplicó, se guarda local pero no rompe los writes.

alter table public.produccion_asignaciones
  add column if not exists winners jsonb not null default '[]'::jsonb;
