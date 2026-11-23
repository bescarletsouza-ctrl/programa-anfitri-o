-- =============================================================================
-- 0053 — Preenche a "Origem do lead" de quem JÁ entrou por integração (antes da 0052).
--
-- Usa o log de entregas da integração (webhook_entregas): para cada participante criado por uma integração,
-- procura no que ela mandou a origem (source / origem / utm_source…); se não tiver nenhuma, usa o NOME DA
-- INTEGRAÇÃO. Só preenche quem está em branco — nunca sobrescreve. Quem veio por convite de anfitrião não
-- precisa: a lista mostra o nome do anfitrião. Se o log foi apagado, não há o que recuperar (fica em branco).
-- Pré-requisito: 0052. Idempotente. Rode no SQL Editor.
-- =============================================================================

with criados as materialized (
  select distinct on (e.payload->'resultado'->>'id')
         e.payload->'resultado'->>'id' as pid_txt,
         e.payload->'recebido'         as rec,
         i.nome                        as integ
    from public.webhook_entregas e
    join public.integracoes i on i.id = e.integracao_id
   where e.gatilho = 'entrada'
     and e.ok
     and e.payload->'resultado'->>'acao' = 'criado'
     and e.payload->'resultado'->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   order by e.payload->'resultado'->>'id', e.at asc
)
update public.participantes p
   set origem_lead = left(coalesce(
         case when jsonb_typeof(c.rec->'source') = 'string' then nullif(trim(c.rec->>'source'), '') end,
         nullif(trim(c.rec->>'origem'), ''),
         nullif(trim(c.rec->>'utm_source'), ''),
         nullif(trim(jsonb_path_query_first(c.rec, 'lax $.**.utm_source') #>> '{}'), ''),
         nullif(trim(jsonb_path_query_first(c.rec, 'lax $.**.lead_source') #>> '{}'), ''),
         nullif(trim(jsonb_path_query_first(c.rec, 'lax $.**.origem') #>> '{}'), ''),
         c.integ
       ), 200)
  from criados c
 where p.id = c.pid_txt::uuid
   and (p.origem_lead is null or trim(p.origem_lead) = '');
