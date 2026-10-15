-- =============================================================================
-- 0040 — Data de entrada RETROATIVA na etapa atual (pro prazo/SLA).
--
-- Antes da 0037 a plataforma não guardava quando o card mudou de etapa, então a
-- data exata de entrada dos cards que já existiam não está em lugar nenhum. Aqui
-- ela é reconstruída com a melhor informação disponível e marcada como ESTIMADA
-- (movimentacoes_pipeline.estimada = true; a tela mostra "~" / "estimada"):
--   * participante na PRIMEIRA etapa  → data do cadastro (é onde ele nasceu);
--   * participante em outra etapa     → última alteração do registro (updated_at,
--                                        migração 0036) — nunca antes do cadastro;
--   * anfitrião (sem updated_at)      → data do cadastro.
-- Só preenche quem ainda não tem NENHUM registro; quem tem histórico real não é
-- tocado. Assim que o card for movido, passa a valer a data real. Idempotente.
-- =============================================================================
alter table public.movimentacoes_pipeline
  add column if not exists estimada boolean not null default false;

-- participantes
insert into public.movimentacoes_pipeline
  (evento_id, registro_tipo, registro_id, de_nome, para_nome, em, estimada)
select p.evento_id, 'participante', p.id, null, e.nome,
       case
         when e.id = (select f.id from public.etapas_participante f
                       where f.evento_id = p.evento_id order by f.ordem, f.id limit 1)
           then p.created_at
         else greatest(p.created_at, p.updated_at)
       end,
       true
from public.participantes p
join public.etapas_participante e on e.id = p.etapa_id
where not exists (
  select 1 from public.movimentacoes_pipeline m
   where m.registro_tipo = 'participante' and m.registro_id = p.id
);

-- anfitriões
insert into public.movimentacoes_pipeline
  (evento_id, registro_tipo, registro_id, de_nome, para_nome, em, estimada)
select a.evento_id, 'anfitriao', a.id, null, s.nome, a.created_at, true
from public.anfitrioes a
join public.estagios s on s.id = a.estagio_id
where not exists (
  select 1 from public.movimentacoes_pipeline m
   where m.registro_tipo = 'anfitriao' and m.registro_id = a.id
);

-- a função agora também devolve se a data é estimada ("est")
create or replace function public.ultimas_movimentacoes(p_evento uuid, p_tipo text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(x.registro_id,
      jsonb_build_object('de', x.de_nome, 'para', x.para_nome, 'em', x.em, 'est', x.estimada)),
    '{}'::jsonb)
  from (
    select distinct on (m.registro_id) m.registro_id, m.de_nome, m.para_nome, m.em, m.estimada
      from public.movimentacoes_pipeline m
     where m.evento_id = p_evento and m.registro_tipo = p_tipo
     order by m.registro_id, m.em desc
  ) x;
$$;
