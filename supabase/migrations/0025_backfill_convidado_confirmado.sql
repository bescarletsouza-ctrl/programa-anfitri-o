-- =============================================================================
-- 0025 — Backfill: convidado cujo participante ligado já está com presença
-- confirmada (presente = true) passa a "Confirmado" agora — antes desta
-- correção, o check-in nunca refletia de volta no status do convidado.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

update public.convidados c
set status = 'Confirmado'
from public.participantes p
where p.convidado_id = c.id
  and p.presente is true
  and c.status is distinct from 'Confirmado';
