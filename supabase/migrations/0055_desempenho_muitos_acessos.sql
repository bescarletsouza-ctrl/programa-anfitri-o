-- =============================================================================
-- 0055 — Desempenho com muitos logins e aparelhos ao mesmo tempo.
--
-- 1) ultimas_movimentacoes (histórico das etapas, chamada a cada abertura de Participantes e Anfitriões) era a
--    consulta que mais gastava tempo: a regra "pode ver o evento?" rodava em CADA linha do histórico. Agora
--    ela é conferida UMA vez, no começo. A permissão é a mesma de antes (a única regra de leitura da tabela é
--    evento_visivel); quem não pode ver o evento continua recebendo vazio.
-- 2) Índices pras listas que as telas e o app mais pedem.
--
-- Pré-requisitos: 0040 e 0051. Não apaga nem altera dados. Pode rodar mais de uma vez. Rode no SQL Editor.
-- =============================================================================

create or replace function public.ultimas_movimentacoes(p_evento uuid, p_tipo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(x.registro_id,
      jsonb_build_object('de', x.de_nome, 'para', x.para_nome, 'em', x.em, 'est', x.estimada)),
    '{}'::jsonb)
  from (
    select distinct on (m.registro_id) m.registro_id, m.de_nome, m.para_nome, m.em, m.estimada
      from public.movimentacoes_pipeline m
     where (select public.evento_visivel(p_evento))      -- permissão: conferida uma única vez
       and m.evento_id = p_evento and m.registro_tipo = p_tipo
     order by m.registro_id, m.em desc
  ) x;
$$;
revoke execute on function public.ultimas_movimentacoes(uuid, text) from public, anon;
grant  execute on function public.ultimas_movimentacoes(uuid, text) to authenticated;

create index if not exists movimentacoes_ultima_idx
  on public.movimentacoes_pipeline (evento_id, registro_tipo, registro_id, em desc);
create index if not exists participantes_evento_criado_idx
  on public.participantes (evento_id, created_at desc);
create index if not exists participantes_evento_atualizado_idx
  on public.participantes (evento_id, updated_at);
create index if not exists convidados_evento_criado_idx
  on public.convidados (evento_id, created_at desc);
create index if not exists anfitrioes_evento_idx2
  on public.anfitrioes (evento_id);
