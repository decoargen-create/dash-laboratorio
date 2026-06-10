-- =========================================================================
-- STORAGE POLICY FIX para bucket 'creativos' — habilitar el path
-- producto-fotos/<user_id>/... que usa src/productoImagen.js.
--
-- Bug: la policy original (0003) sólo permitía paths con user_id como
-- PRIMER folder ('<uid>/foo.png'). Pero productoImagen.js sube a
-- 'producto-fotos/<uid>/<productoId>.jpg' → RLS deniega → la foto del
-- producto nunca llega al bucket → cross-device no aparece la foto.
--
-- Esta migración extiende las 3 policies (INSERT, UPDATE, DELETE) con un
-- OR que admite ambos formatos de path:
--   1. <uid>/...                          → galería referenciales
--   2. producto-fotos/<uid>/...           → foto del producto
--
-- Idempotente: drop policy if exists antes del create.
-- =========================================================================

do $$
begin
  if exists (select 1 from storage.buckets where id = 'creativos') then
    -- INSERT: usuario puede subir a <uid>/* o producto-fotos/<uid>/*
    execute $POLICY$
      drop policy if exists "creativos_user_upload" on storage.objects;
      create policy "creativos_user_upload" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'creativos'
          and (
            (storage.foldername(name))[1] = auth.uid()::text
            or (
              (storage.foldername(name))[1] = 'producto-fotos'
              and (storage.foldername(name))[2] = auth.uid()::text
            )
          )
        );
    $POLICY$;

    -- UPDATE: idem
    execute $POLICY$
      drop policy if exists "creativos_user_update" on storage.objects;
      create policy "creativos_user_update" on storage.objects
        for update to authenticated
        using (
          bucket_id = 'creativos'
          and (
            (storage.foldername(name))[1] = auth.uid()::text
            or (
              (storage.foldername(name))[1] = 'producto-fotos'
              and (storage.foldername(name))[2] = auth.uid()::text
            )
          )
        );
    $POLICY$;

    -- DELETE: idem
    execute $POLICY$
      drop policy if exists "creativos_user_delete" on storage.objects;
      create policy "creativos_user_delete" on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'creativos'
          and (
            (storage.foldername(name))[1] = auth.uid()::text
            or (
              (storage.foldername(name))[1] = 'producto-fotos'
              and (storage.foldername(name))[2] = auth.uid()::text
            )
          )
        );
    $POLICY$;

    raise notice 'Storage policies actualizadas para soportar producto-fotos/<uid>/*';
  else
    raise notice 'Bucket creativos NO existe — saltando policies';
  end if;
end $$;
