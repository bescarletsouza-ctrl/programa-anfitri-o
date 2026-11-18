-- =============================================================================
-- 0045 — Perfis de usuário: ADMIN e AGENTE.
--
--  admin   tudo (inclusive gerenciar usuários da organização)
--  agente  opera o dia a dia: cadastra/edita participantes e anfitriões, credencia,
--          faz check-in, transfere, importa, mexe no pipeline, escreve observações.
--          NÃO pode: aprovar/recusar convidados, excluir participantes/anfitriões/
--          convidados, alterar tipos de ingresso (e campos personalizados), metas
--          do planejamento, formulário de inscrição, automações, integrações e
--          configurações do evento (tipos, etapas/estágios, marcos, tema, crachá-
--          layout fica liberado pro app de check-in).
--
-- A regra vale NO BANCO (triggers), não só na tela: mesmo chamando a API direto, o
-- agente é barrado. Service role (Edge Functions, webhooks) e a admin da plataforma
-- não são afetados. Idempotente.
--
-- A 1ª vez que roda, também ajusta os perfis atuais: os 6 logins abaixo viram
-- admin e TODOS os demais viram agente. (Roda uma vez só — as próximas execuções
-- não mexem mais nos perfis, pra não desfazer ajustes feitos depois pela tela.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Papéis: 'admin' | 'agente'   ('membro' antigo vira 'agente')
-- -----------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.org_membros'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%papel%'
  loop
    execute format('alter table public.org_membros drop constraint %I', c.conname);
  end loop;
end $$;
update public.org_membros set papel = 'agente' where papel is distinct from 'admin';
alter table public.org_membros add constraint org_membros_papel_check check (papel in ('admin', 'agente'));
alter table public.org_membros alter column papel set default 'agente';

-- controle de "rodar uma vez" (sem acesso pelo navegador)
create table if not exists public.migracoes_unicas (
  chave    text primary key,
  feito_em timestamptz not null default now()
);
alter table public.migracoes_unicas enable row level security;
revoke all on public.migracoes_unicas from anon, authenticated;

do $$
begin
  if not exists (select 1 from public.migracoes_unicas where chave = '0045_papeis') then
    update public.org_membros m
       set papel = case
         when lower(split_part(coalesce(nullif(btrim(m.email), ''), u.email, ''), '@', 1)) in
              ('breenda.souza', 'edy.oliveira', 'henrique.cardoso', 'marcelo.novais', 'nicolas.prati', 'rafael.ramos')
         then 'admin' else 'agente' end
      from auth.users u
     where u.id = m.user_id;
    insert into public.migracoes_unicas (chave) values ('0045_papeis');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Quem é "agente" num evento: logado, não é admin da plataforma e não é admin
--    da organização dona do evento. Sem login (service role / público) = não é.
-- -----------------------------------------------------------------------------
create or replace function public.sou_agente(p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not public.eh_plataforma_admin()
     and not exists (
       select 1 from public.eventos e
         join public.org_membros m on m.org_id = e.org_id
        where e.id = p_evento and m.user_id = auth.uid() and m.papel = 'admin'
     );
$$;
revoke execute on function public.sou_agente(uuid) from public, anon;
grant  execute on function public.sou_agente(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Bloqueios por tabela. Argumentos do trigger: (o que o agente tentou, operações
--    bloqueadas: I=insert U=update D=delete)
-- -----------------------------------------------------------------------------
create or replace function public.agente_bloqueio()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_evento uuid;
begin
  if position(left(tg_op, 1) in tg_argv[1]) = 0 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_evento := ((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'evento_id')::uuid;
  if public.sou_agente(v_evento) then
    raise exception 'O perfil Agente não pode %. Peça a um administrador.', tg_argv[0] using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare x record;
begin
  for x in
    select * from (values
      ('tipos_ingresso',       'alterar tipos de ingresso',            'IUD'),
      ('campos_personalizados','alterar campos personalizados',        'IUD'),
      ('form_perguntas',       'alterar o formulário de inscrição',    'IUD'),
      ('automacoes',           'alterar automações',                   'IUD'),
      ('integracoes',          'alterar integrações',                  'IUD'),
      ('estagios',             'alterar as configurações do evento',   'IUD'),
      ('etapas_participante',  'alterar as configurações do evento',   'IUD'),
      ('marcos',               'alterar as configurações do evento',   'IUD'),
      ('grupos',               'alterar as configurações do evento',   'UD')   -- criar tipo novo sai de importações; editar/excluir é config
    ) as t(tabela, acao, ops)
  loop
    if to_regclass('public.' || x.tabela) is not null then
      execute format('drop trigger if exists trg_agente_bloqueio on public.%I', x.tabela);
      execute format('create trigger trg_agente_bloqueio before insert or update or delete on public.%I
                      for each row execute function public.agente_bloqueio(%L, %L)', x.tabela, x.acao, x.ops);
    end if;
  end loop;
end $$;

-- exclusão de participante / anfitrião / convidado. Poupa as linhas "espelho" que o
-- próprio sistema cria e apaga sozinho ao mudar o tipo (participante↔anfitrião).
create or replace function public.agente_bloqueio_exclusao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'participantes' and coalesce((to_jsonb(old) ->> 'origem_anfitriao')::boolean, false) then return old; end if;
  if tg_table_name = 'anfitrioes'    and coalesce((to_jsonb(old) ->> 'origem_participante')::boolean, false) then return old; end if;
  if public.sou_agente(old.evento_id) then
    raise exception 'O perfil Agente não pode excluir registros. Peça a um administrador.' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists trg_agente_exclusao on public.participantes;
create trigger trg_agente_exclusao before delete on public.participantes for each row execute function public.agente_bloqueio_exclusao();
drop trigger if exists trg_agente_exclusao on public.anfitrioes;
create trigger trg_agente_exclusao before delete on public.anfitrioes   for each row execute function public.agente_bloqueio_exclusao();
drop trigger if exists trg_agente_exclusao on public.convidados;
create trigger trg_agente_exclusao before delete on public.convidados   for each row execute function public.agente_bloqueio_exclusao();

-- aprovação: mudar o status do convidado (Pendente/Aprovado/Recusado/Confirmado)
create or replace function public.agente_bloqueio_aprovacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and coalesce(new.status, 'Pendente') <> 'Pendente')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if public.sou_agente(new.evento_id) then
      raise exception 'O perfil Agente não pode aprovar ou recusar convidados. Peça a um administrador.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_agente_aprovacao on public.convidados;
create trigger trg_agente_aprovacao before insert or update on public.convidados
  for each row execute function public.agente_bloqueio_aprovacao();

-- evento: o agente só mexe no que o fluxo do dia a dia precisa (contador de códigos
-- na criação/transferência de participantes e o layout do crachá no app de check-in).
create or replace function public.agente_bloqueio_eventos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if public.sou_agente(old.id) then
      raise exception 'O perfil Agente não pode excluir eventos. Peça a um administrador.' using errcode = '42501';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - 'proximo_codigo' - 'cracha_config' - 'updated_at')
     is distinct from (to_jsonb(old) - 'proximo_codigo' - 'cracha_config' - 'updated_at')
     and public.sou_agente(new.id) then
    raise exception 'O perfil Agente não pode alterar as configurações do evento (nem as metas do planejamento). Peça a um administrador.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_agente_eventos on public.eventos;
create trigger trg_agente_eventos before update or delete on public.eventos
  for each row execute function public.agente_bloqueio_eventos();

-- automações: aplicar a regra nos participantes que já existem é ato de admin
-- (só se a 0043 — Automações — já rodou neste banco)
do $do$
begin
  if to_regclass('public.automacoes') is not null
     and to_regprocedure('public.auto_aplicar_acoes(jsonb,uuid,public.participantes)') is not null then
    execute $f$
      create or replace function public.automacao_aplicar_existentes(p_id uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare a public.automacoes; p public.participantes; r public.participantes; n int := 0;
      begin
        select * into a from public.automacoes where id = p_id;
        if not found then raise exception 'Automação não encontrada.'; end if;
        if not public.evento_visivel(a.evento_id) then raise exception 'Sem acesso a este evento.'; end if;
        if public.sou_agente(a.evento_id) then raise exception 'O perfil Agente não pode alterar automações. Peça a um administrador.'; end if;
        for p in select * from public.participantes where evento_id = a.evento_id order by created_at loop
          if public.auto_cond_ok(a.condicoes, to_jsonb(p)) then
            r := public.auto_aplicar_acoes(a.acoes, a.evento_id, p);
            if to_jsonb(r) is distinct from to_jsonb(p) then
              update public.participantes
                 set tipo = r.tipo, ingresso = r.ingresso, situacao = r.situacao,
                     etapa_id = r.etapa_id, responsavel_user_id = r.responsavel_user_id
               where id = p.id;
              insert into public.automacao_execucoes (automacao_id, evento_id, participante_id, origem, mudancas)
              values (a.id, a.evento_id, p.id, 'retroativo', public.auto_diff(to_jsonb(p), to_jsonb(r)));
              n := n + 1;
            end if;
          end if;
        end loop;
        return jsonb_build_object('alterados', n);
      end $body$
    $f$;
    execute 'revoke execute on function public.automacao_aplicar_existentes(uuid) from public, anon';
    execute 'grant  execute on function public.automacao_aplicar_existentes(uuid) to authenticated';
  end if;
end $do$;

-- conferência: quem ficou com qual perfil
select coalesce(nullif(btrim(m.email), ''), u.email) as login, m.nome, m.papel, o.nome as organizacao
  from public.org_membros m
  left join auth.users u on u.id = m.user_id
  left join public.organizacoes o on o.id = m.org_id
 order by m.papel, login;
