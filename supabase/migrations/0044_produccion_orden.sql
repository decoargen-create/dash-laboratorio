-- Orden manual de las tarjetas dentro de cada columna del tablero de
-- Producción: se arrastra una tarjeta arriba/abajo de otra y se renumera la
-- columna (1 = primera). El tablero del admin y el del editor ordenan por
-- este campo primero y después por prioridad.
alter table public.produccion_asignaciones add column if not exists orden integer;
