-- =============================================================================
-- 0041 — Quantos prêmios (marcos) são REVELADOS na jornada do painel do
-- anfitrião antes de serem conquistados. Ex.: 3 → o prêmio das 3 primeiras
-- bandeiras e o prêmio final aparecem; os intermediários continuam bloqueados.
-- Vazio/0 = todos bloqueados até conquistar. Todas as bandeiras sempre
-- aparecem no mapa. Configurável por evento em Configurações. Idempotente.
-- (o nome da coluna ficou "marcos_visiveis" da primeira versão da ideia)
-- =============================================================================
alter table public.eventos
  add column if not exists marcos_visiveis int check (marcos_visiveis is null or marcos_visiveis >= 0);
