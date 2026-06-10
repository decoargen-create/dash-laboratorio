-- =========================================================================
-- MARKETING_CREATIVOS — extender con flag de "winner" + métricas que justifican
--
-- Un creativo se marca como "winner" cuando el user lo publicó en Meta Ads,
-- lo dejó correr, y concluye que rinde lo suficiente para escalar / iterar.
-- Esa marca habilita:
--   - Vista filtrada "Winners" dentro de Galería
--   - Análisis agregado: qué ángulos / hooks están funcionando
--   - "Iterar desde winner" → crea ideas en la bandeja basadas en lo que ganó
--
-- Idempotente. Si las columnas ya existen, el ALTER se vuelve no-op.
-- =========================================================================

alter table public.marketing_creativos
  add column if not exists winner boolean default false,
  add column if not exists winner_at timestamptz,
  -- winner_metrics: JSON libre con métricas + ad_id + qué funcionó + notas.
  -- Shape esperado (todos opcionales):
  --   {
  --     ad_id: string,           Meta ad id donde corrió
  --     days_running: number,
  --     ctr: number,             %
  --     roas: number,
  --     cpa: number,             USD
  --     thumb_stop: number,      %
  --     impressions: number,
  --     purchases: number,
  --     que_funciono: string[],  ['hook','visual','copy','cta','angulo']
  --     notas: string,
  --   }
  add column if not exists winner_metrics jsonb;

-- Index para queries "dame los winners de este producto".
create index if not exists idx_marketing_creativos_user_producto_winner
  on public.marketing_creativos(user_id, producto_id, winner)
  where winner = true;
