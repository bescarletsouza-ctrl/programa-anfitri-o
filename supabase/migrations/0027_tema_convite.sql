-- =============================================================================
-- 0027 — Evento pode ter um "tema" de convite personalizado (layout + copy
-- diferentes do convite.html padrão). Hoje só existe o tema "nitro10x";
-- eventos sem tema continuam com o convite genérico de sempre.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.eventos add column if not exists tema_convite text;
