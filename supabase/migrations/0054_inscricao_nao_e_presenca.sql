-- =============================================================================
-- 0054 — Inscrever em atividade NÃO é presença.
--
-- Até aqui, "Adicionar participantes" e "Importar lista" (tela Atividades da plataforma) gravavam junto uma
-- ENTRADA para cada pessoa — então os inscritos contavam como "presentes no local". A plataforma já foi
-- corrigida (agora só inscreve). Este script limpa as entradas que foram criadas desse jeito:
--   • origem "atividades-import" (importação);
--   • origem "atividades" gravadas em lote (mesmo instante para 2+ pessoas) ou junto com a inscrição.
-- NÃO mexe em entradas lidas no app (QR) nem nas registradas uma a uma na tela de Check-in da plataforma.
-- A inscrição de cada pessoa é mantida. Uma cópia do que for apagado fica em checkins_inscricoes_removidas.
-- Limite: uma pessoa adicionada SOZINHA antes da lista de inscritos existir não dá pra distinguir.
-- Pré-requisito: 0048. Pode rodar mais de uma vez. Rode no SQL Editor.
-- =============================================================================

begin;

create table if not exists public.checkins_inscricoes_removidas (like public.checkins);
alter table public.checkins_inscricoes_removidas enable row level security;   -- sem políticas: ninguém lê pela API
revoke all on public.checkins_inscricoes_removidas from anon, authenticated;

create temporary table alvo_0054 on commit drop as
select c.id, c.evento_id, c.atividade_id, c.participante_id, c.at
  from public.checkins c
 where c.atividade_id is not null
   and c.acao = 'entrada'
   and ( c.origem = 'atividades-import'
      or (c.origem = 'atividades' and (
              exists (select 1 from public.checkins o
                       where o.atividade_id = c.atividade_id and o.origem = c.origem
                         and o.acao = 'entrada' and o.at = c.at and o.id <> c.id)
           or exists (select 1 from public.atividade_inscritos i
                       where i.atividade_id = c.atividade_id and i.participante_id = c.participante_id
                         and i.operador = 'plataforma'
                         and i.created_at between c.at - interval '5 seconds' and c.at + interval '60 seconds'))));

-- 1) garante que todo mundo continua INSCRITO
insert into public.atividade_inscritos (evento_id, atividade_id, participante_id, operador)
select distinct a.evento_id, a.atividade_id, a.participante_id, 'plataforma'
  from alvo_0054 a
on conflict (atividade_id, participante_id) do nothing;

-- 2) guarda cópia e apaga as entradas que não eram presença
insert into public.checkins_inscricoes_removidas
select c.* from public.checkins c join alvo_0054 a on a.id = c.id;

delete from public.checkins c using alvo_0054 a where c.id = a.id;

-- 3) saída que ficou "sem entrada" por causa disso também sai (senão a próxima entrada real não contaria)
with orfas as (
  select s.id
    from public.checkins s
   where s.acao = 'saida'
     and exists (select 1 from alvo_0054 a where a.atividade_id = s.atividade_id and a.participante_id = s.participante_id)
     and not exists (select 1 from public.checkins e
                      where e.atividade_id = s.atividade_id and e.participante_id = s.participante_id
                        and e.acao = 'entrada' and e.at <= s.at)
), copia as (
  insert into public.checkins_inscricoes_removidas
  select c.* from public.checkins c join orfas o on o.id = c.id
  returning id
)
delete from public.checkins c using copia where c.id = copia.id;

commit;

-- quantos registros foram retirados (ao todo, somando execuções anteriores)
select count(*) as registros_retirados from public.checkins_inscricoes_removidas;
