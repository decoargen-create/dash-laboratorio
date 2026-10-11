-- Migration 0035 — etiqueta de campaña en las tarjetas de Producción
--
-- Para marcar tarjetas de fechas comerciales ("💐 Día de la Madre", "Cyber",
-- etc.): el admin la elige en el detalle de la tarjeta y se muestra como chip
-- en el tablero (admin y editor). Texto libre corto; la UI ofrece presets.

alter table public.produccion_asignaciones
  add column if not exists etiqueta text;
