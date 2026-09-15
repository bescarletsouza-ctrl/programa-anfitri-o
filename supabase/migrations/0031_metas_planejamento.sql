-- =============================================================================
-- 0031 — Metas de planejamento do evento (aba "Planejamento").
-- Guarda os alvos editáveis (inscritos/presentes por grupo, showrate) e quais
-- dois Tipos de Ingresso representam os grupos "A"/"B" (ex.: LIFE / MASTER)
-- direto no evento, como já é feito com cracha_config.
-- =============================================================================
alter table public.eventos
  add column if not exists metas_planejamento jsonb not null default '{}'::jsonb;
