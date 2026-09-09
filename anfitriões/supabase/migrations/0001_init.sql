-- =============================================================================
-- Programa Anfitrião — schema inicial
-- Rode este arquivo inteiro no SQL Editor de um projeto Supabase NOVO/dedicado.
-- Estilo: tudo em public, RLS habilitado, comentários em PT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grupos (turmas / cohorts). Editável no admin.
-- -----------------------------------------------------------------------------
create table if not exists public.grupos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  cor        text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Responsáveis (quem acompanha cada anfitrião). Editável no admin.
-- -----------------------------------------------------------------------------
create table if not exists public.responsaveis (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Estágios do funil de anfitriões. Editável no admin (nome / ordem / cor).
-- -----------------------------------------------------------------------------
create table if not exists public.estagios (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int  not null default 0,
  cor        text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Anfitriões (quem convida). "slug" é usado nos links públicos (fase seguinte).
-- -----------------------------------------------------------------------------
create table if not exists public.anfitrioes (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique default replace(gen_random_uuid()::text, '-', ''),
  nome           text not null,
  email          text,
  telefone       text,
  tipo           text not null default 'Titular',
  grupo_id       uuid references public.grupos(id) on delete set null,
  responsavel_id uuid references public.responsaveis(id) on delete set null,
  estagio_id     uuid references public.estagios(id) on delete set null,
  vai            boolean not null default true,   -- false = "Não vão"
  presenca       boolean not null default false,
  observacao     text,
  created_at     timestamptz not null default now()
);

create index if not exists anfitrioes_grupo_idx       on public.anfitrioes(grupo_id);
create index if not exists anfitrioes_responsavel_idx on public.anfitrioes(responsavel_id);
create index if not exists anfitrioes_estagio_idx     on public.anfitrioes(estagio_id);

-- -----------------------------------------------------------------------------
-- Convidados (empreendedores convidados por um anfitrião).
-- "respostas" guarda respostas de perguntas personalizadas do formulário.
-- -----------------------------------------------------------------------------
create table if not exists public.convidados (
  id           uuid primary key default gen_random_uuid(),
  anfitriao_id uuid not null references public.anfitrioes(id) on delete cascade,
  nome         text,
  email        text,
  telefone     text,
  empresa      text,
  cnpj         text,
  site         text,
  faturamento  text,
  funcionarios text,
  status       text not null default 'Pendente',  -- Pendente | Aprovado | Recusado | Confirmado
  observacao   text,
  respostas    jsonb not null default '{}'::jsonb,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  created_at   timestamptz not null default now()
);

create index if not exists convidados_anfitriao_idx on public.convidados(anfitriao_id);
create index if not exists convidados_status_idx    on public.convidados(status);

-- -----------------------------------------------------------------------------
-- Perguntas do formulário de inscrição (o convite público consome na fase 2).
-- sistema = true  -> mapeia para uma coluna fixa de "convidados"; chave travada,
--                    não pode ser excluída (só editar rótulo / obrigatório / opções).
-- -----------------------------------------------------------------------------
create table if not exists public.form_perguntas (
  id          uuid primary key default gen_random_uuid(),
  ordem       int  not null default 0,
  chave       text not null unique,
  rotulo      text not null,
  tipo        text not null default 'texto',  -- texto|email|telefone|url|selecao|textarea
  obrigatorio boolean not null default true,
  opcoes      jsonb not null default '[]'::jsonb,
  ativo       boolean not null default true,
  sistema     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Config global do sistema (1 linha só).
-- -----------------------------------------------------------------------------
create table if not exists public.config (
  id                int primary key default 1 check (id = 1),
  nome_produto      text not null default 'Programa Anfitrião',
  subtitulo_convite text default 'Você foi indicado para participar.',
  texto_confirmacao text default 'Aplicação recebida! Nossa equipe vai avaliar e retornar em breve.',
  meta_confirmados  int  not null default 0,
  updated_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- View de conveniência: anfitrião + contadores de convidados.
-- -----------------------------------------------------------------------------
create or replace view public.anfitrioes_com_stats as
select
  a.*,
  coalesce(c.enviados, 0)    as enviados,
  coalesce(c.aprovados, 0)   as aprovados,
  coalesce(c.confirmados, 0) as confirmados
from public.anfitrioes a
left join (
  select
    anfitriao_id,
    count(*)                                                   as enviados,
    count(*) filter (where status in ('Aprovado', 'Confirmado')) as aprovados,
    count(*) filter (where status = 'Confirmado')              as confirmados
  from public.convidados
  group by anfitriao_id
) c on c.anfitriao_id = a.id;

-- =============================================================================
-- RLS
-- TEMPORÁRIO: enquanto não existe login (Supabase Auth), o admin é aberto por
-- URL e usa a chave "anon". As policies abaixo liberam tudo para "anon".
-- Quando o Auth entrar: remover estas policies e criar policies por papel
-- (ex.: só "authenticated" com role = 'admin' pode escrever).
-- =============================================================================
alter table public.grupos        enable row level security;
alter table public.responsaveis  enable row level security;
alter table public.estagios      enable row level security;
alter table public.anfitrioes    enable row level security;
alter table public.convidados    enable row level security;
alter table public.form_perguntas enable row level security;
alter table public.config        enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'grupos','responsaveis','estagios','anfitrioes','convidados','form_perguntas','config'
  ]
  loop
    execute format('drop policy if exists "anon full access" on public.%I;', t);
    execute format(
      'create policy "anon full access" on public.%I
         for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- Grants explícitos para a role pública "anon" (tabelas + view de stats).
-- A view roda como owner (não-invoker), então lê os agregados ignorando RLS —
-- comportamento aceitável nesta fase "aberta".
grant usage on schema public to anon;
grant select, insert, update, delete on
  public.grupos, public.responsaveis, public.estagios, public.anfitrioes,
  public.convidados, public.form_perguntas, public.config
  to anon;
grant select on public.anfitrioes_com_stats to anon;

-- =============================================================================
-- SEEDS
-- Sem grupos, sem responsáveis, sem anfitriões, sem convidados (reset pedido).
-- =============================================================================

-- Config (linha única)
insert into public.config (id) values (1)
on conflict (id) do nothing;

-- Estágios do funil (genéricos — sem referência a "Private10x").
-- Só insere se a tabela estiver vazia (evita duplicar ao rodar de novo).
insert into public.estagios (nome, ordem, cor)
select * from (values
  ('Não contatado',      1, '#9ca3af'),
  ('Contatado',          2, '#f59e0b'),
  ('Apresentação feita', 3, '#fb923c'),
  ('Convites enviados',  4, '#ea580c'),
  ('Confirmado',         5, '#16a34a')
) as v(nome, ordem, cor)
where not exists (select 1 from public.estagios);

-- Perguntas padrão do formulário de inscrição (as 8 do fluxo original)
insert into public.form_perguntas (ordem, chave, rotulo, tipo, obrigatorio, opcoes, sistema) values
  (1, 'nome',        'Qual o seu nome completo?',        'texto',    true,  '[]'::jsonb, true),
  (2, 'email',       'Qual o seu melhor e-mail?',        'email',    true,  '[]'::jsonb, true),
  (3, 'telefone',    'Qual o seu WhatsApp?',             'telefone', true,  '[]'::jsonb, true),
  (4, 'empresa',     'Qual o nome da sua empresa?',      'texto',    true,  '[]'::jsonb, true),
  (5, 'site',        'Qual o site da empresa?',          'url',      true,  '[]'::jsonb, true),
  (6, 'faturamento', 'Qual o faturamento mensal?',       'selecao',  true,
      '["Não faturo ainda","Até 50 mil/mês","50 mil – 150 mil/mês","150 mil – 500 mil/mês","500 mil – 1 milhão/mês","1 milhão – 5 milhões/mês","5 milhões – 10 milhões/mês","Acima de 10 milhões/mês"]'::jsonb,
      true),
  (7, 'funcionarios','Quantos funcionários na empresa?', 'selecao',  true,
      '["1–5","6–15","16–50","51–100","101–500","500+"]'::jsonb, true),
  (8, 'cnpj',        'Qual o CNPJ?',                     'texto',    false, '[]'::jsonb, true)
on conflict (chave) do nothing;
