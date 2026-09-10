-- =============================================================================
-- ROLLBACK do 0017 — volta a RLS "aberta" (anon + authenticated com using(true)).
-- Rode se o flip quebrou algo. Depois: reverter no git o commit que apontou
-- convite/painel/status.js para a função "publico".
-- =============================================================================
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'eventos','grupos','responsaveis','estagios','anfitrioes','convidados','form_perguntas',
    'marcos','etapas_participante','participantes','checkins','atividades',
    'tipos_ingresso','integracoes','webhook_entregas'
  ] loop
    execute format('drop policy if exists "escopo da org" on public.%I;', t);
    execute format('drop policy if exists "eventos da org" on public.%I;', t);
    execute format('drop policy if exists "entregas da org" on public.%I;', t);
    execute format('drop policy if exists "anon full access" on public.%I;', t);
    execute format('drop policy if exists "auth full access" on public.%I;', t);
    execute format('create policy "anon full access" on public.%I for all to anon using (true) with check (true);', t);
    execute format('create policy "auth full access" on public.%I for all to authenticated using (true) with check (true);', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated;', t);
  end loop;
end $$;

alter view public.anfitrioes_com_stats set (security_invoker = off);
alter view public.ranking_publico      set (security_invoker = off);
grant select on public.anfitrioes_com_stats, public.ranking_publico to anon, authenticated;

grant execute on function public.criar_evento(text, uuid, date, text) to anon, authenticated;

commit;
