-- Habilita Supabase Realtime para las tablas de Producción, así mover/editar/
-- subir una tarjeta impacta al instante en todos los usuarios. La RLS se respeta
-- (cada uno recibe solo los cambios de las filas que puede ver). Ya aplicada.
alter publication supabase_realtime add table public.produccion_asignaciones;
alter publication supabase_realtime add table public.produccion_pagos;
alter publication supabase_realtime add table public.produccion_pago_config;
