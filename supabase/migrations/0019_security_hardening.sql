-- Hardening de seguridad (auditoría de la plataforma).
--
-- Dos policies que quedaron demasiado abiertas. Ambas son de bajo riesgo de
-- romper algo (el backend usa service_role, que bypassa RLS igual).

-- 1) Bucket `competidores-ads`: la policy de INSERT NO restringía el rol, así
--    que aplicaba a `public` (incluye anon). Como el bucket es público y la
--    VITE_SUPABASE_ANON_KEY es extraíble del bundle, cualquiera podía subir
--    archivos arbitrarios a un bucket servido desde el dominio. El backend sube
--    con service_role (que ignora RLS), así que restringir a service_role no
--    rompe las subidas legítimas — solo cierra el agujero para anon.
drop policy if exists "service write competidores-ads" on storage.objects;
create policy "service write competidores-ads" on storage.objects
  for insert to service_role
  with check (bucket_id = 'competidores-ads');

-- 2) `profiles`: el UPDATE self no tenía WITH CHECK → un usuario podía escalar
--    su propio `role` a 'admin' desde el cliente con la anon key
--    (update profiles set role='admin' where id = auth.uid()). Agregamos un
--    WITH CHECK que obliga a que el role NUEVO sea igual al ACTUAL almacenado,
--    permitiendo actualizar el resto de los campos pero NO el role.
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
