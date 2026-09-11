-- =============================================================================
-- 0019 — Responsável (usuário da plataforma) por categoria de ingresso.
-- Mesma ideia do responsável em "grupos" (0018), agora para tipos_ingresso.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.tipos_ingresso add column if not exists responsavel_user_id uuid
  references auth.users(id) on delete set null;
create index if not exists tipos_ingresso_responsavel_idx on public.tipos_ingresso(responsavel_user_id);
