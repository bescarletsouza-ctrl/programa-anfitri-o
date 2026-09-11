-- =============================================================================
-- 0022 — Marco "prêmio final": em vez de digitar um número de confirmados
-- solto, o marco pode se vincular à Meta de confirmados do evento (a mesma
-- usada no funil de convidados). Assim, se a meta mudar, o marco acompanha
-- sem precisar editar de novo.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.marcos add column if not exists meta_final boolean not null default false;
