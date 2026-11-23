-- =============================================================================
-- 0052 — Origem do lead (de onde o participante veio).
--
-- Guarda, em cada participante, a origem que a integração mandou (source / utm_source / origem…).
-- Quem veio por convite de anfitrião não usa isto: a lista mostra o NOME DO ANFITRIÃO (vem do convite).
-- Coluna opcional na lista de Participantes (Colunas → "Origem do lead").
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

alter table public.participantes
  add column if not exists origem_lead text;
