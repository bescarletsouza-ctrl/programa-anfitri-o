-- =============================================================================
-- 0021 — Participante gerado a partir de um convidado (aprovado pelo link do
-- anfitrião) passa a herdar o responsável do PRÓPRIO ANFITRIÃO que convidou,
-- em vez do responsável da categoria de ingresso. Isso é feito no código
-- (supabase.js: sincParticipanteConvidado / reSincResponsavelAnfitriao) a
-- partir de agora; esta migração só corrige os registros que já existiam.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

update public.participantes p
set responsavel_user_id = a.responsavel_user_id
from public.convidados c
join public.anfitrioes a on a.id = c.anfitriao_id
where p.convidado_id = c.id
  and p.responsavel_user_id is distinct from a.responsavel_user_id;
