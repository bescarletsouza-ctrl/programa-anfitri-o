-- =============================================================================
-- 0023 — Anfitrião ganha a própria "Categoria de ingresso" (igual a
-- participantes.ingresso, texto livre). Ao cadastrar/editar o anfitrião, ela
-- já vai junto pro participante gerado a partir dele (sincAnfitriaoParticipante).
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.anfitrioes add column if not exists ingresso text;

-- a view "anfitrioes_com_stats" faz "select a.*" — precisa recriar para expor
-- a coluna nova (mesmo padrão de 0010_anfitriao_participante.sql e 0020).
drop view if exists public.anfitrioes_com_stats;
create view public.anfitrioes_com_stats as
select
  a.*,
  coalesce(c.enviados, 0)    as enviados,
  coalesce(c.aprovados, 0)   as aprovados,
  coalesce(c.confirmados, 0) as confirmados
from public.anfitrioes a
left join (
  select anfitriao_id,
    count(*)                                                     as enviados,
    count(*) filter (where status in ('Aprovado', 'Confirmado')) as aprovados,
    count(*) filter (where status = 'Confirmado')                as confirmados
  from public.convidados
  group by anfitriao_id
) c on c.anfitriao_id = a.id;
grant select on public.anfitrioes_com_stats to anon;

-- Backfill: participante já ligado a um anfitrião (tipo = 'Anfitrião') herda a
-- categoria e o responsável do anfitrião agora, mesmo que o vínculo já
-- existisse antes desta coluna (o responsável já cadastrado no anfitrião não
-- tinha ido para o participante gerado a partir dele).
update public.participantes p
set ingresso = a.ingresso, responsavel_user_id = a.responsavel_user_id
from public.anfitrioes a
where p.anfitriao_id = a.id
  and p.tipo = 'Anfitrião'
  and (p.ingresso is distinct from a.ingresso or p.responsavel_user_id is distinct from a.responsavel_user_id);
