-- =============================================================================
-- 0020 — Responsável de anfitrião/participante vira o usuário atribuído à
-- categoria (Tipo / Categoria de ingresso), em vez do cadastro livre antigo
-- (tabela "responsaveis", ainda existe mas não é mais usada pela interface).
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.anfitrioes add column if not exists responsavel_user_id uuid
  references auth.users(id) on delete set null;
create index if not exists anfitrioes_responsavel_user_idx on public.anfitrioes(responsavel_user_id);

alter table public.participantes add column if not exists responsavel_user_id uuid
  references auth.users(id) on delete set null;
create index if not exists participantes_responsavel_user_idx on public.participantes(responsavel_user_id);

-- Backfill: anfitrião herda o responsável do Tipo (grupo) já vinculado.
update public.anfitrioes a
set responsavel_user_id = g.responsavel_user_id
from public.grupos g
where a.grupo_id = g.id
  and g.responsavel_user_id is not null
  and a.responsavel_user_id is null;

-- Backfill: participante herda o responsável da Categoria de ingresso (mais
-- específica) e, na falta dela, do Tipo.
update public.participantes p
set responsavel_user_id = t.responsavel_user_id
from public.tipos_ingresso t
where t.evento_id = p.evento_id
  and lower(t.nome) = lower(p.ingresso)
  and t.responsavel_user_id is not null
  and p.responsavel_user_id is null;

update public.participantes p
set responsavel_user_id = g.responsavel_user_id
from public.grupos g
where g.evento_id = p.evento_id
  and lower(g.nome) = lower(p.tipo)
  and g.responsavel_user_id is not null
  and p.responsavel_user_id is null;

-- A view "anfitrioes_com_stats" faz "select a.*" — precisa recriar para
-- expor a coluna nova (mesmo padrão usado em 0010_anfitriao_participante.sql).
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
