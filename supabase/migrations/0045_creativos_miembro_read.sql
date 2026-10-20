-- Cuentas por área: los miembros VEÍAN las filas de marketing_creativos del
-- dueño (policy mk_creativos_miembro_all) pero el Storage solo dejaba leer los
-- archivos de la carpeta propia (auth.uid()), así que no podían firmar las
-- URLs y la galería les salía con todas las imágenes rotas. Lectura (solo
-- SELECT) de la carpeta del dueño y de sus fotos de producto.
drop policy if exists "creativos_miembro_read" on storage.objects;
create policy "creativos_miembro_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'creativos'
    and public.miembro_owner() is not null
    and (
      (storage.foldername(name))[1] = public.miembro_owner()::text
      or ((storage.foldername(name))[1] = 'producto-fotos'
          and (storage.foldername(name))[2] = public.miembro_owner()::text)
    )
  );
