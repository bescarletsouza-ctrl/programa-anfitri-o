-- =============================================================================
-- 0036 — API de leitura (Edge Function "api"): tokens somente-leitura, log de
-- acessos, "atualizado em" confiável (pra sincronização incremental) e as
-- consultas paginadas que a função chama.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- Nada aqui é exposto ao navegador: as tabelas novas ficam sem acesso pra
-- anon/authenticated (só a service role da Edge Function lê/escreve) e as
-- funções só rodam pela service role ou pelo SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. updated_at em eventos, participantes e convidados
--    (existentes: começam com o created_at, então a 1ª sincronização completa
--    sai em ordem; daí pra frente o trigger mantém sozinho)
-- -----------------------------------------------------------------------------
alter table public.eventos      add column if not exists updated_at timestamptz;
alter table public.participantes add column if not exists updated_at timestamptz;
alter table public.convidados   add column if not exists updated_at timestamptz;

update public.eventos       set updated_at = created_at where updated_at is null;
update public.participantes set updated_at = created_at where updated_at is null;
update public.convidados    set updated_at = created_at where updated_at is null;

alter table public.eventos
  alter column updated_at set default now(), alter column updated_at set not null;
alter table public.participantes
  alter column updated_at set default now(), alter column updated_at set not null;
alter table public.convidados
  alter column updated_at set default now(), alter column updated_at set not null;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- evento: o contador de códigos (proximo_codigo) muda a cada participante novo
-- e não deve contar como "o evento mudou"
create or replace function public.eventos_touch_updated_at()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'proximo_codigo' - 'updated_at')
       is distinct from (to_jsonb(old) - 'proximo_codigo' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_eventos_updated_at on public.eventos;
create trigger trg_eventos_updated_at before update on public.eventos
  for each row execute function public.eventos_touch_updated_at();

drop trigger if exists trg_participantes_updated_at on public.participantes;
create trigger trg_participantes_updated_at before update on public.participantes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_convidados_updated_at on public.convidados;
create trigger trg_convidados_updated_at before update on public.convidados
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Tokens e log de acessos
--    O token em si NUNCA é guardado — só o hash (SHA-256). Quem gera vê o
--    token uma única vez, no retorno de criar_api_token().
-- -----------------------------------------------------------------------------
create table if not exists public.api_tokens (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  org_id             uuid references public.organizacoes(id) on delete cascade,
  plataforma_inteira boolean not null default false,
  token_hash         text not null unique,
  prefixo            text not null,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  revogado_em        timestamptz,
  ultimo_uso_em      timestamptz,
  constraint api_tokens_escopo check (
    (plataforma_inteira and org_id is null) or (not plataforma_inteira and org_id is not null)
  )
);

create table if not exists public.api_log (
  id       bigint generated always as identity primary key,
  token_id uuid references public.api_tokens(id) on delete cascade,
  em       timestamptz not null default now(),
  metodo   text,
  caminho  text,
  status   int,
  ip       text,
  qtd      int
);
create index if not exists api_log_token_em_idx on public.api_log(token_id, em desc);
create index if not exists api_log_em_idx on public.api_log(em);

alter table public.api_tokens enable row level security;
alter table public.api_log    enable row level security;
revoke all on public.api_tokens from anon, authenticated;
revoke all on public.api_log    from anon, authenticated;

-- gera um token novo e devolve ele UMA vez (guarde na hora).
--   Token de uma organização:      select * from criar_api_token('DTS dashboard', '<uuid da org>');
--   Token da plataforma inteira:   select * from criar_api_token('Interno', null, true);
create or replace function public.criar_api_token(
  p_nome text, p_org_id uuid default null, p_plataforma_inteira boolean default false
)
returns table(token_id uuid, token text, escopo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if btrim(coalesce(p_nome, '')) = '' then
    raise exception 'Informe um nome para o token.';
  end if;
  if p_plataforma_inteira and p_org_id is not null then
    raise exception 'Use p_org_id OU p_plataforma_inteira, não os dois.';
  end if;
  if not p_plataforma_inteira and p_org_id is null then
    raise exception 'Informe a organização (p_org_id) ou use p_plataforma_inteira => true.';
  end if;
  if p_org_id is not null and not exists (select 1 from public.organizacoes o where o.id = p_org_id) then
    raise exception 'Organização não encontrada.';
  end if;

  v_token := 'wev_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.api_tokens (nome, org_id, plataforma_inteira, token_hash, prefixo)
  values (btrim(p_nome), p_org_id, p_plataforma_inteira,
          encode(sha256(convert_to(v_token, 'utf8')), 'hex'), left(v_token, 8))
  returning api_tokens.id into v_id;

  return query select v_id, v_token,
    case when p_plataforma_inteira then 'plataforma inteira'
         else 'organização ' || p_org_id::text end;
end $$;

-- revoga na hora (a próxima chamada com esse token já volta 401)
create or replace function public.revogar_api_token(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_tokens
     set ativo = false, revogado_em = coalesce(revogado_em, now())
   where id = p_id;
$$;

revoke execute on function public.criar_api_token(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.revogar_api_token(uuid)               from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Consultas da API (paginação por cursor: ordena por atualizado_em, id)
--    p_org = null → todos os eventos da plataforma (token "plataforma inteira")
-- -----------------------------------------------------------------------------
create or replace function public.api_eventos(
  p_org uuid, p_desde timestamptz, p_status text,
  p_after_ts timestamptz, p_after_id uuid, p_limit int
)
returns table(
  id uuid, nome text, data_evento date, status text, local text,
  criado_em timestamptz, atualizado_em timestamptz
)
language sql
stable
set search_path = public
as $$
  select x.id, x.nome, x.data_evento, x.status, x.local, x.criado_em, x.atualizado_em
  from (
    select e.id, e.nome, e.data_evento, e.local,
           case when e.ativo is false then 'inativo'
                when e.data_evento is not null
                     and e.data_evento < (now() at time zone 'America/Sao_Paulo')::date then 'encerrado'
                else 'ativo' end as status,
           e.created_at as criado_em, e.updated_at as atualizado_em
    from public.eventos e
    where (p_org is null or e.org_id = p_org)
  ) x
  where (p_desde is null or x.atualizado_em >= p_desde)
    and (p_status is null or x.status = p_status)
    and (p_after_ts is null or (x.atualizado_em, x.id) > (p_after_ts, p_after_id))
  order by x.atualizado_em, x.id
  limit p_limit;
$$;

-- devolve os campos "crus"; o status_inscricao e o valor_pago são calculados na
-- Edge Function (assim a regra fica num lugar só, com testes)
create or replace function public.api_participantes(
  p_org uuid, p_evento uuid, p_desde timestamptz,
  p_after_ts timestamptz, p_after_id uuid, p_limit int
)
returns table(
  id uuid, evento_id uuid, evento_nome text, tipo text,
  nome text, email text, telefone text,
  ingresso text, preco_ingresso text, quantidade int,
  pagamento text, situacao text, convidado_status text,
  presente boolean, checkin_at timestamptz,
  utm_source text, utm_medium text, utm_campaign text,
  criado_em timestamptz, atualizado_em timestamptz
)
language sql
stable
set search_path = public
as $$
  select x.id, x.evento_id, x.evento_nome, x.tipo,
         x.nome, x.email, x.telefone,
         x.ingresso, x.preco_ingresso, x.quantidade,
         x.pagamento, x.situacao, x.convidado_status,
         x.presente, x.checkin_at,
         x.utm_source, x.utm_medium, x.utm_campaign,
         x.criado_em, x.atualizado_em
  from (
    select p.id, p.evento_id, e.nome as evento_nome, p.tipo,
           p.nome, p.email, p.telefone,
           p.ingresso, ti.preco as preco_ingresso, p.quantidade,
           p.pagamento, p.situacao, c.status as convidado_status,
           coalesce(p.presente, false) as presente, p.checkin_at,
           c.utm_source, c.utm_medium, c.utm_campaign,
           p.created_at as criado_em,
           greatest(p.updated_at, c.updated_at) as atualizado_em
    from public.participantes p
    join public.eventos e on e.id = p.evento_id
    left join public.convidados c on c.id = p.convidado_id
    left join lateral (
      select t.preco
        from public.tipos_ingresso t
       where t.evento_id = p.evento_id
         and lower(btrim(t.nome)) = lower(btrim(p.ingresso))
       limit 1
    ) ti on true
    where (p_org is null or e.org_id = p_org)
      and (p_evento is null or p.evento_id = p_evento)
  ) x
  where (p_desde is null or x.atualizado_em >= p_desde)
    and (p_after_ts is null or (x.atualizado_em, x.id) > (p_after_ts, p_after_id))
  order by x.atualizado_em, x.id
  limit p_limit;
$$;

revoke execute on function public.api_eventos(uuid, timestamptz, text, timestamptz, uuid, int)       from public, anon, authenticated;
revoke execute on function public.api_participantes(uuid, uuid, timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
grant  execute on function public.api_eventos(uuid, timestamptz, text, timestamptz, uuid, int)       to service_role;
grant  execute on function public.api_participantes(uuid, uuid, timestamptz, timestamptz, uuid, int) to service_role;
