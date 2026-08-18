-- Producción — link de material por producto en la tarjeta.
--
-- Cada producto puede tener una carpeta de Drive con TODO el material (guiones,
-- fotos, referencias). Guardamos ese link en la tarjeta (no en el catálogo de
-- productos) por dos razones:
--   1. El catálogo marketing_productos tiene RLS por usuario, así que un editor
--      (otro user) no lo vería. La tarjeta sí la ve el editor asignado.
--   2. Así viaja con la asignación y el chico lo abre directo desde su tablero.
--
-- El link es "por producto": la app lo copia a todas las tarjetas del mismo
-- producto (ver setMaterialLinkProducto en produccionStore.js). La columna es
-- opcional; el front la detecta (como con `historial`) y solo la escribe si
-- existe, así nada se rompe antes de aplicar esta migración.

alter table public.produccion_asignaciones
  add column if not exists material_link text default '';
