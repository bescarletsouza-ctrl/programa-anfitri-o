-- =============================================================================
-- 0013 — Etapa do pipeline pode fixar a "situação" do participante.
--   Ao mover o card para uma etapa com situacao_alvo definida, a situação do
--   participante no cadastro muda junto (ex.: etapa "Confirmado" → Confirmado;
--   etapa "Não vai" → Desativado).
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

alter table public.etapas_participante
  add column if not exists situacao_alvo text;
