-- =============================================================================
-- 0046 — Acesso por evento (por usuário).
--
-- Até aqui todo membro da organização via TODOS os eventos dela. Agora o admin pode,
-- por usuário, escolher "só estes eventos" e, em cada um, o tipo de acesso:
--   • credenciamento      → usa o app de check-in do evento (QR, acessos, atividades, impressão
--                           e a lista de participantes dentro do app)
--   • gestao              → gerencia os participantes do evento na plataforma
--
-- Regras (nada muda pra quem não for restringido):
--   - super-admin e admin da organização: sempre veem todos os eventos;
--   - membro com restringir_eventos = false (padrão): vê todos, como sempre;
--   - membro com restringir_eventos = true: só os eventos com linha em evento_acessos.
--
-- O banco usa "vê o evento se tiver QUALQUER um dos dois acessos" (os dados são os mesmos pro app e
-- pra plataforma). A separação app × plataforma é feita nas telas.
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

alter table public.org_membros
  add column if not exists restringir_eventos boolean not null default false;

create table if not exists public.evento_acessos (
  id             uuid primary key default gen_random_uuid(),
  evento_id      uuid not null references public.eventos(id)   on delete cascade,
  user_id        uuid not null references auth.users(id)       on delete cascade,
  credenciamento boolean not null default false,
  gestao         boolean not null default false,
  criado_em      timestamptz not null default now(),
  unique (evento_id, user_id)
);
create index if not exists evento_acessos_user_idx on public.evento_acessos(user_id);

alter table public.evento_acessos enable row level security;
revoke all on public.evento_acessos from anon;
grant select on public.evento_acessos to authenticated;   -- escrita só pela Edge Function "equipe" (service role)

-- cada um enxerga os próprios acessos; super-admin e admin da organização enxergam os do evento
drop policy if exists "evento_acessos leitura" on public.evento_acessos;
create policy "evento_acessos leitura" on public.evento_acessos for select to authenticated
  using (
    user_id = auth.uid()
    or public.eh_plataforma_admin()
    or exists (select 1 from public.eventos e
                where e.id = evento_acessos.evento_id
                  and e.org_id in (select public.orgs_que_administro()))
  );

-- ---------------------------------------------------------------------------
-- Função central: o usuário logado tem acesso a este evento? (p_nivel: 'credenciamento' | 'gestao' | null = qualquer)
-- ---------------------------------------------------------------------------
create or replace function public.acesso_evento(p_evento uuid, p_nivel text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_plataforma_admin()
      or exists (
        select 1
          from public.eventos e
          join public.org_membros m on m.org_id = e.org_id and m.user_id = auth.uid()
         where e.id = p_evento
           and ( m.papel = 'admin'
              or not m.restringir_eventos
              or exists (
                   select 1 from public.evento_acessos a
                    where a.evento_id = e.id and a.user_id = auth.uid()
                      and case p_nivel
                            when 'credenciamento' then a.credenciamento
                            when 'gestao'         then a.gestao
                            else a.credenciamento or a.gestao
                          end))
      );
$$;
grant execute on function public.acesso_evento(uuid, text) to authenticated;

-- Todas as tabelas do evento já usam evento_visivel(): é só passar a respeitar o acesso por evento.
create or replace function public.evento_visivel(p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.acesso_evento(p_evento, null);
$$;

-- A própria tabela de eventos: quem é restringido não enxerga (nem edita) os outros eventos da org.
drop policy if exists "eventos da org" on public.eventos;
create policy "eventos da org" on public.eventos for all to authenticated
  using      (public.eh_plataforma_admin()
              or org_id in (select public.orgs_que_administro())
              or public.acesso_evento(id, null))
  with check (public.eh_plataforma_admin() or org_id in (select public.orgs_do_usuario()));
