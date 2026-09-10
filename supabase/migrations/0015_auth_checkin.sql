-- =============================================================================
-- We.events — libera o papel "authenticated" nas mesmas tabelas que o "anon".
-- O app de check-in mobile (checkin-app.html) faz login via Supabase Auth; sem
-- isso as requisições autenticadas bateriam na RLS e voltariam vazias.
-- O restante do admin continua usando a chave anon (aberto, como antes).
-- Idempotente.
--
-- Como criar as contas da equipe:
--   Supabase Studio → Authentication → Users → Add user (defina e-mail e senha).
--   Em Authentication → Providers → Email, deixe "Confirm email" desligado para
--   a pessoa entrar direto, ou confirme o e-mail manualmente.
-- =============================================================================

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "auth full access" on public.%I;', t);
    execute format(
      'create policy "auth full access" on public.%I for all to authenticated using (true) with check (true);', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- views usadas pelo painel (não pelo check-in, mas mantém a paridade)
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public'
  loop
    execute format('grant select on public.%I to authenticated;', v);
  end loop;
end $$;
