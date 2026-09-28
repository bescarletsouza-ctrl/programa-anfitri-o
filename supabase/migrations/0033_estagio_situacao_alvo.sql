-- =============================================================================
-- 0033 — Estágio do funil de Anfitriões pode mudar a situação do anfitrião
-- (Pré-inscrito, Confirmado…) quando o card é movido pra ele — igual às
-- etapas do pipeline de Participantes (etapas_participante.situacao_alvo).
-- A situação em si mora no participante ligado ao anfitrião (participantes.situacao).
-- Idempotente.
-- =============================================================================
alter table public.estagios
  add column if not exists situacao_alvo text;
