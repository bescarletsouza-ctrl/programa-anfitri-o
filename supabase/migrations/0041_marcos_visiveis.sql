-- =============================================================================
-- 0041 — Quantos prêmios (marcos) aparecem na jornada do painel do anfitrião.
-- Ex.: 3 → o mapa mostra os 3 primeiros prêmios + o prêmio final. Vazio/0 =
-- mostra todos. Configurável por evento em Configurações. Idempotente.
-- =============================================================================
alter table public.eventos
  add column if not exists marcos_visiveis int check (marcos_visiveis is null or marcos_visiveis >= 0);
