-- =============================================================================
-- 0024 — Ranking público conta por convidado APROVADO (Aprovado + Confirmado),
-- não só "Confirmado" — mesmo critério já usado na jornada do painel do
-- anfitrião (ver commit anterior). Antes disso, o ranking ficava zerado até o
-- dia do evento (quando os convidados viram "Confirmado" no check-in).
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

-- troca o nome da coluna (confirmados -> aprovados): "create or replace"
-- não permite renomear coluna de view, precisa dropar e recriar.
drop view if exists public.ranking_publico;
create view public.ranking_publico as
select
  a.id, a.nome, a.slug, a.evento_id,
  g.nome as grupo,
  coalesce(count(c.*) filter (where c.status in ('Aprovado', 'Confirmado')), 0) as aprovados
from public.anfitrioes a
left join public.convidados c on c.anfitriao_id = a.id
left join public.grupos g     on g.id = a.grupo_id
where a.vai is true
group by a.id, a.nome, a.slug, a.evento_id, g.nome;

grant select on public.ranking_publico to anon;
