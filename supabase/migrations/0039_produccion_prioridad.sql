-- Migration 0039 — prioridad en las tarjetas de Producción
--
-- De la reunión del equipo (12/10): "vamos a ir ordenando por prioridades...
-- cosa que ustedes también puedan seguir el orden". 1 = alta, 2 = media,
-- 3 = baja, null = sin prioridad (va último). El tablero (admin y editor)
-- ordena cada columna por este campo.

alter table public.produccion_asignaciones
  add column if not exists prioridad int;
