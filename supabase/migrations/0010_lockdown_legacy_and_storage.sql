-- =========================================================================
-- Migration 0010 — Cerrar agujeros de aislamiento entre usuarios.
--
-- Contexto: la app es multi-usuario (vos + colegas). Cada uno debe ver SOLO
-- lo suyo. Auditoría encontró dos fugas heredadas de 0001_initial_schema.sql:
--
-- 1) BUCKET 'creativos': 0006 agregó políticas por-usuario (insert/update/
--    delete) PERO no borró las permisivas del 0001 ("auth read/write/update/
--    delete creativos", que usan auth.role()='authenticated'). Como las
--    policies RLS se combinan con OR, las permisivas seguían activas →
--    cualquier usuario logueado podía leer/escribir/borrar objetos de otro.
--    Además 0006 nunca agregó una policy de SELECT por-usuario.
--
-- 2) TABLAS LEGACY del 0001 (workspaces, productos, ideas, run_history,
--    costs_log, creativos): policy "auth full access" = cualquier autenticado
--    lee/escribe TODO. El código actual NO las usa (todo vive en marketing_*),
--    pero quedan accesibles. Las cerramos por higiene/defensa.
--
-- Idempotente. NO toca datos.
-- =========================================================================

-- ----- 1) STORAGE: bucket 'creativos' solo accesible por su dueño ----------
-- Borramos las policies permisivas heredadas del 0001.
drop policy if exists "auth read creativos"   on storage.objects;
drop policy if exists "auth write creativos"  on storage.objects;
drop policy if exists "auth update creativos" on storage.objects;
drop policy if exists "auth delete creativos" on storage.objects;

-- SELECT por-usuario (faltaba). Mismo criterio de path que el insert/update/
-- delete de 0006: dueño = primer segmento del path, o producto-fotos/<uid>/*.
-- El backend sube/lee con service_role, que bypassea RLS, así que el cloud
-- save sigue funcionando; esto solo restringe el acceso de los CLIENTES.
drop policy if exists "creativos_user_read" on storage.objects;
create policy "creativos_user_read" on storage.objects
  for select to authenticated
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

-- ----- 2) TABLAS LEGACY sin uso: quitar el acceso compartido ---------------
-- Dropear la policy permisiva deja la tabla con RLS habilitado y SIN policy
-- = deny-all (nadie accede vía cliente). Si en el futuro se reusa alguna,
-- habrá que agregarle una policy por-usuario explícita.
drop policy if exists "auth full access" on workspaces;
drop policy if exists "auth full access" on productos;
drop policy if exists "auth full access" on ideas;
drop policy if exists "auth full access" on run_history;
drop policy if exists "auth full access" on costs_log;
drop policy if exists "auth full access" on creativos;
