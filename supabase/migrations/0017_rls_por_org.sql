-- =============================================================================
-- 0017 — Isola o acesso por organização (o "flip").
--
-- *** PONTO SEM VOLTA. Rode SÓ depois que: ***
--   - 0016 já rodou;
--   - as funções plataforma/equipe estão no ar e o bootstrap foi feito;
--   - existe ao menos uma organização cliente de teste validada;
--   - a função "publico" está deployada E o commit que aponta
--     convite/painel/status.js para ela já está no ar.
--
-- Depois deste script: o `anon` NÃO lê mais nenhuma tabela; as páginas
-- públicas passam pela Edge Function "publico"; cada organização só vê os
-- próprios eventos/participantes/anfitriões; a super-admin vê tudo.
--
-- Rollback: supabase/migrations/rollback_0017.sql
-- =============================================================================
begin;

-- -----------------------------------------------------------------------------
-- 1. Usuários de auth que já existiam (equipe de check-in) → org "We.events"
-- -----------------------------------------------------------------------------
insert into public.org_membros (org_id, user_id, email, papel)
select o.id, u.id, u.email, 'membro'
from auth.users u
cross join (select id from public.organizacoes where nome = 'We.events') o
on conflict (org_id, user_id) do nothing;
-- (promova os admins reais da We.events a papel='admin' pelo painel ou por SQL.)

-- -----------------------------------------------------------------------------
-- 2. eventos: RLS por organização + leitura pública some
-- -----------------------------------------------------------------------------
drop policy if exists "anon full access" on public.eventos;
drop policy if exists "auth full access" on public.eventos;
create policy "eventos da org" on public.eventos for all to authenticated
  using  (public.eh_plataforma_admin() or org_id in (select public.orgs_do_usuario()))
  with check (public.eh_plataforma_admin() or org_id in (select public.orgs_do_usuario()));
revoke all on public.eventos from anon;

-- -----------------------------------------------------------------------------
-- 3. As 13 tabelas escopadas por evento_id
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'grupos','responsaveis','estagios','anfitrioes','convidados','form_perguntas',
    'marcos','etapas_participante','participantes','checkins','atividades',
    'tipos_ingresso','integracoes'
  ] loop
    execute format('drop policy if exists "anon full access" on public.%I;', t);
    execute format('drop policy if exists "auth full access" on public.%I;', t);
    execute format(
      'create policy "escopo da org" on public.%I for all to authenticated
         using (public.evento_visivel(evento_id))
         with check (public.evento_visivel(evento_id));', t);
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. webhook_entregas (evento_id nullable, sem FK)
-- -----------------------------------------------------------------------------
drop policy if exists "anon full access" on public.webhook_entregas;
drop policy if exists "auth full access" on public.webhook_entregas;
create policy "entregas da org" on public.webhook_entregas for all to authenticated
  using (public.eh_plataforma_admin() or public.evento_visivel(evento_id))
  with check (true);   -- inserção real é via service role
revoke all on public.webhook_entregas from anon;

-- -----------------------------------------------------------------------------
-- 5. Views deixam de furar a RLS (rodam com a permissão de quem chama)
-- -----------------------------------------------------------------------------
alter view public.anfitrioes_com_stats set (security_invoker = on);
alter view public.ranking_publico      set (security_invoker = on);
revoke all on public.anfitrioes_com_stats from anon;
revoke all on public.ranking_publico     from anon;

-- -----------------------------------------------------------------------------
-- 6. criar_evento não é mais chamável por anon
-- -----------------------------------------------------------------------------
revoke execute on function public.criar_evento(text, uuid, date, text) from anon;

commit;
