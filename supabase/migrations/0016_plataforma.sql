-- =============================================================================
-- 0016 — Plataforma multi-tenant: organizações, membros, admins da plataforma.
--
-- ADITIVO: NÃO altera nenhuma policy das tabelas existentes. O /admin continua
-- funcionando pela chave pública. O "lockdown" (RLS por organização) é o 0017,
-- que só deve ser rodado DEPOIS que o login e o painel da plataforma estiverem
-- no ar e validados.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.organizacoes (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,                 -- nome de exibição
  empresa      text,                          -- razão social / nome da empresa
  ramo         text,                          -- ramo de atuação
  faturamento  text,                          -- faixa de faturamento (texto livre)
  telefone     text,
  email        text,                          -- contato principal
  acesso       text not null default 'tudo'
               check (acesso in ('tudo', 'eventos', 'anfitrioes')),
  max_eventos  int,                            -- null = ilimitado
  expira_em    date,                           -- null = sem prazo
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

create table if not exists public.org_membros (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizacoes(id) on delete cascade,
  user_id   uuid not null references auth.users(id)          on delete cascade,
  nome      text,
  email     text,
  telefone  text,
  papel     text not null default 'membro' check (papel in ('admin', 'membro')),
  criado_em timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_membros_user_idx on public.org_membros(user_id);
create index if not exists org_membros_org_idx  on public.org_membros(org_id);

create table if not exists public.plataforma_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. eventos.org_id — NULLABLE por ora (criar_evento passa a exigir; NOT NULL
--    fica para uma migração posterior, depois de validado em produção).
-- -----------------------------------------------------------------------------
alter table public.eventos add column if not exists org_id uuid
  references public.organizacoes(id) on delete cascade;
create index if not exists eventos_org_idx on public.eventos(org_id);

-- -----------------------------------------------------------------------------
-- 3. Organização dona dos dados atuais + backfill
-- -----------------------------------------------------------------------------
do $$
declare v_org uuid;
begin
  select id into v_org from public.organizacoes where nome = 'We.events' limit 1;
  if v_org is null then
    insert into public.organizacoes (nome, empresa, acesso)
    values ('We.events', 'We.events', 'tudo')
    returning id into v_org;
  end if;
  update public.eventos set org_id = v_org where org_id is null;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Helpers para RLS (STABLE + SECURITY DEFINER → ignoram RLS, sem recursão)
-- -----------------------------------------------------------------------------
create or replace function public.eh_plataforma_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plataforma_admins where user_id = auth.uid());
$$;

create or replace function public.orgs_do_usuario()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_membros where user_id = auth.uid();
$$;

create or replace function public.orgs_que_administro()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_membros where user_id = auth.uid() and papel = 'admin';
$$;

create or replace function public.evento_visivel(p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_plataforma_admin()
      or exists (
        select 1 from public.eventos e
        where e.id = p_evento
          and e.org_id in (select public.orgs_do_usuario())
      );
$$;

grant execute on function
  public.eh_plataforma_admin(),
  public.orgs_do_usuario(),
  public.orgs_que_administro(),
  public.evento_visivel(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS SÓ nas tabelas novas (as existentes ficam para o 0017)
-- -----------------------------------------------------------------------------
alter table public.organizacoes      enable row level security;
alter table public.org_membros       enable row level security;
alter table public.plataforma_admins enable row level security;

drop policy if exists "org visivel" on public.organizacoes;
create policy "org visivel" on public.organizacoes for select to authenticated
  using (public.eh_plataforma_admin() or id in (select public.orgs_do_usuario()));

drop policy if exists "org plataforma rw" on public.organizacoes;
create policy "org plataforma rw" on public.organizacoes for all to authenticated
  using (public.eh_plataforma_admin()) with check (public.eh_plataforma_admin());

drop policy if exists "membros da org" on public.org_membros;
create policy "membros da org" on public.org_membros for select to authenticated
  using (
    public.eh_plataforma_admin()
    or user_id = auth.uid()
    or org_id in (select public.orgs_que_administro())
  );

drop policy if exists "le plataforma_admins" on public.plataforma_admins;
create policy "le plataforma_admins" on public.plataforma_admins for select to authenticated
  using (public.eh_plataforma_admin() or user_id = auth.uid());
-- escrita em org_membros / plataforma_admins: só pela service role (Edge Function).

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.organizacoes, public.org_membros, public.plataforma_admins
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6. criar_evento v2 — recebe a organização, valida limite + prazo + permissão
-- -----------------------------------------------------------------------------
drop function if exists public.criar_evento(text, date, text);

create or replace function public.criar_evento(
  p_nome text,
  p_org_id uuid,
  p_data date default null,
  p_local text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_org    public.organizacoes;
  v_usados int;
begin
  if p_org_id is null then
    raise exception 'Organização é obrigatória';
  end if;

  select * into v_org from public.organizacoes where id = p_org_id;
  if not found then
    raise exception 'Organização não encontrada';
  end if;

  if not public.eh_plataforma_admin()
     and not exists (
       select 1 from public.org_membros
       where org_id = p_org_id and user_id = auth.uid()
     ) then
    raise exception 'Sem permissão para criar eventos nesta organização';
  end if;

  if not v_org.ativo then
    raise exception 'Organização inativa. Fale com o suporte.';
  end if;

  if v_org.expira_em is not null and v_org.expira_em < current_date then
    raise exception 'Plano expirado em %.', to_char(v_org.expira_em, 'DD/MM/YYYY');
  end if;

  if v_org.max_eventos is not null then
    select count(*) into v_usados from public.eventos where org_id = p_org_id;
    if v_usados >= v_org.max_eventos then
      raise exception 'Limite de % evento(s) do plano atingido.', v_org.max_eventos;
    end if;
  end if;

  insert into public.eventos (nome, data_evento, local, org_id)
  values (nullif(trim(p_nome), ''), p_data, nullif(trim(p_local), ''), p_org_id)
  returning id into v_id;

  if v_id is null then
    raise exception 'Nome do evento é obrigatório';
  end if;

  -- estrutura padrão (idêntica à de 0005_eventos.sql)
  insert into public.estagios (evento_id, nome, ordem, cor) values
    (v_id, 'Não contatado',      1, '#9ca3af'),
    (v_id, 'Contatado',          2, '#f59e0b'),
    (v_id, 'Apresentação feita', 3, '#fb923c'),
    (v_id, 'Convites enviados',  4, '#ea580c'),
    (v_id, 'Confirmado',         5, '#16a34a');

  insert into public.etapas_participante (evento_id, nome, ordem, cor) values
    (v_id, 'Nova inscrição',          1, '#2563eb'),
    (v_id, '1º contato',              2, '#f59e0b'),
    (v_id, 'Aguardando acompanhante', 3, '#fb923c'),
    (v_id, 'Confirmação de presença', 4, '#ea580c'),
    (v_id, 'Confirmado',              5, '#16a34a');

  insert into public.marcos (evento_id, quantidade, titulo, descricao, ordem) values
    (v_id, 3,  'Primeiro marco', 'Descreva aqui o reconhecimento ou brinde deste marco.', 1),
    (v_id, 6,  'Segundo marco',  'Descreva aqui o reconhecimento ou brinde deste marco.', 2),
    (v_id, 10, 'Terceiro marco', 'Descreva aqui o reconhecimento ou brinde deste marco.', 3);

  insert into public.form_perguntas (evento_id, ordem, chave, rotulo, tipo, obrigatorio, opcoes, sistema) values
    (v_id, 1, 'nome',        'Qual o seu nome completo?',        'texto',    true,  '[]'::jsonb, true),
    (v_id, 2, 'email',       'Qual o seu melhor e-mail?',        'email',    true,  '[]'::jsonb, true),
    (v_id, 3, 'telefone',    'Qual o seu WhatsApp?',             'telefone', true,  '[]'::jsonb, true),
    (v_id, 4, 'empresa',     'Qual o nome da sua empresa?',      'texto',    true,  '[]'::jsonb, true),
    (v_id, 5, 'site',        'Qual o site da empresa?',          'url',      true,  '[]'::jsonb, true),
    (v_id, 6, 'faturamento', 'Qual o faturamento mensal?',       'selecao',  true,
      '["Não faturo ainda","Até 50 mil/mês","50 mil – 150 mil/mês","150 mil – 500 mil/mês","500 mil – 1 milhão/mês","1 milhão – 5 milhões/mês","5 milhões – 10 milhões/mês","Acima de 10 milhões/mês"]'::jsonb, true),
    (v_id, 7, 'funcionarios','Quantos funcionários na empresa?', 'selecao',  true,
      '["1–5","6–15","16–50","51–100","101–500","500+"]'::jsonb, true),
    (v_id, 8, 'cnpj',        'Qual o CNPJ?',                     'texto',    false, '[]'::jsonb, true);

  return v_id;
end $$;

grant execute on function public.criar_evento(text, uuid, date, text) to authenticated;
