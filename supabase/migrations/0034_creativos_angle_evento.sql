-- Migration 0034 — ángulo y evento del creativo generado
--
-- Para la nomenclatura identificable de los archivos descargados
-- ("Cepillo 3-10 Estatico Getaeki Testimonio DiaMadre v2 #ab12cd"):
--   angle  → ángulo estratégico del plan (problem_solution, social_proof,
--            scarcity, …) que el Strategist detectó en el ad de referencia.
--   evento → fecha comercial si la tanda se generó en modo evento
--            (dia_madre, black_friday, …).
-- Solo se llenan para creativos NUEVOS (los viejos no guardaron strategy).

alter table public.marketing_creativos
  add column if not exists angle  text,
  add column if not exists evento text;
