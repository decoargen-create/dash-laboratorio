-- =========================================================================
-- MARKETING REALTIME — habilitar Supabase Realtime en las tablas de marketing
-- para que cambios desde una device se reflejen en vivo en otras devices
-- del mismo user.
-- =========================================================================
--
-- Realtime requiere que cada tabla esté en la publicación supabase_realtime.
-- Una vez agregadas, los clientes que se suscriban via
-- supabase.channel().on('postgres_changes', ...) van a recibir INSERT,
-- UPDATE y DELETE events filtrados por user_id (vía RLS).
--
-- Idempotente: ALTER PUBLICATION ... ADD TABLE solo agrega si no estaba.

-- Productos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_productos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_productos;
  END IF;
END$$;

-- Brands per producto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_brands'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_brands;
  END IF;
END$$;

-- Creativos (galería)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_creativos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_creativos;
  END IF;
END$$;

-- Prefs (active producto, gen opts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_prefs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_prefs;
  END IF;
END$$;

-- Nota: la replica identity (FULL vs DEFAULT) define qué columnas vienen
-- en los DELETE events. FULL es más caro pero permite filtrar por user_id.
-- Usamos FULL para que el filter user_id=eq.X funcione en DELETE también.
ALTER TABLE public.marketing_productos REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_brands REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_creativos REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_prefs REPLICA IDENTITY FULL;
