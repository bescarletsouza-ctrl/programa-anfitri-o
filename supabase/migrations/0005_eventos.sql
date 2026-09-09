-- =============================================================================
-- Programa Anfitrião — Multi-evento
-- Escopa todo o sistema por "evento". Rode no SQL Editor do mesmo projeto.
-- Idempotente onde dá; pode rodar de novo sem quebrar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de eventos (guarda também os textos que ficavam em "config")
-- -----------------------------------------------------------------------------
create table if not exists public.eventos (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  data_evento       date,
  local             text,
  meta_confirmados  int  not null default 0,
  subtitulo_convite text default 'Você foi indicado para participar.',
  texto_confirmacao text default 'Aplicação recebida! Nossa equipe vai avaliar e retornar em breve.',
  texto_em_analise  text default 'Sua aplicação está em análise. Avisaremos assim que houver uma resposta.',
  texto_aprovado    text default 'Boa notícia! Sua aplicação foi aprovada. Em breve entramos em contato com os próximos passos.',
  texto_recusado    text default 'Obrigado pelo seu interesse. Desta vez sua aplicação não foi aprovada.',
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);

alter table public.eventos enable row level security;
drop policy if exists "anon full access" on public.eventos;
create policy "anon full access" on public.eventos for all to anon using (true) with check (true);
grant usage on schema public to anon;
grant select, insert, update, delete on public.eventos to anon;

-- -----------------------------------------------------------------------------
-- 2. Evento inicial a partir da config atual (só se ainda não há eventos)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.eventos) then
    if to_regclass('public.config') is not null then
      insert into public.eventos (nome, meta_confirmados, subtitulo_convite,
        texto_confirmacao, texto_em_analise, texto_aprovado, texto_recusado)
      select 'Imersão XPTO',
             coalesce(c.meta_confirmados, 0),
             coalesce(c.subtitulo_convite, 'Você foi indicado para participar.'),
             coalesce(c.texto_confirmacao, 'Aplicação recebida! Nossa equipe vai avaliar e retornar em breve.'),
             coalesce(c.texto_em_analise,  'Sua aplicação está em análise. Avisaremos assim que houver uma resposta.'),
             coalesce(c.texto_aprovado,    'Boa notícia! Sua aplicação foi aprovada. Em breve entramos em contato com os próximos passos.'),
             coalesce(c.texto_recusado,    'Obrigado pelo seu interesse. Desta vez sua aplicação não foi aprovada.')
      from public.config c where c.id = 1;
    end if;
    if not exists (select 1 from public.eventos) then
      insert into public.eventos (nome) values ('Imersão XPTO');
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Coluna evento_id em todas as tabelas + backfill + not null
-- -----------------------------------------------------------------------------
do $$
declare
  e uuid;
  t text;
  tabs text[] := array['grupos','responsaveis','estagios','anfitrioes','convidados',
                       'form_perguntas','marcos','etapas_participante','participantes'];
begin
  select id into e from public.eventos order by created_at limit 1;

  foreach t in array tabs loop
    execute format('alter table public.%I add column if not exists evento_id uuid references public.eventos(id) on delete cascade;', t);
    execute format('update public.%I set evento_id = %L where evento_id is null;', t, e);
    execute format('alter table public.%I alter column evento_id set not null;', t);
    execute format('create index if not exists %I on public.%I(evento_id);', t || '_evento_idx', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Unicidade por evento
-- -----------------------------------------------------------------------------
alter table public.grupos          drop constraint if exists grupos_nome_key;
alter table public.form_perguntas  drop constraint if exists form_perguntas_chave_key;
create unique index if not exists grupos_evento_nome_uidx         on public.grupos(evento_id, nome);
create unique index if not exists form_perguntas_evento_chave_uidx on public.form_perguntas(evento_id, chave);

-- -----------------------------------------------------------------------------
-- 5. Views
-- -----------------------------------------------------------------------------
create or replace view public.anfitrioes_com_stats as
select
  a.*,
  coalesce(c.enviados, 0)    as enviados,
  coalesce(c.aprovados, 0)   as aprovados,
  coalesce(c.confirmados, 0) as confirmados
from public.anfitrioes a
left join (
  select anfitriao_id,
    count(*)                                                     as enviados,
    count(*) filter (where status in ('Aprovado', 'Confirmado')) as aprovados,
    count(*) filter (where status = 'Confirmado')                as confirmados
  from public.convidados
  group by anfitriao_id
) c on c.anfitriao_id = a.id;

create or replace view public.ranking_publico as
select
  a.id, a.nome, a.slug, a.evento_id,
  g.nome as grupo,
  coalesce(count(c.*) filter (where c.status = 'Confirmado'), 0) as confirmados
from public.anfitrioes a
left join public.convidados c on c.anfitriao_id = a.id
left join public.grupos g     on g.id = a.grupo_id
where a.vai is true
group by a.id, a.nome, a.slug, a.evento_id, g.nome;

grant select on public.anfitrioes_com_stats to anon;
grant select on public.ranking_publico to anon;

-- -----------------------------------------------------------------------------
-- 6. config não é mais usada (virou colunas de eventos)
-- -----------------------------------------------------------------------------
drop table if exists public.config;

-- -----------------------------------------------------------------------------
-- 7. Criação de evento + estrutura padrão, em uma transação
-- -----------------------------------------------------------------------------
create or replace function public.criar_evento(p_nome text, p_data date default null, p_local text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.eventos (nome, data_evento, local)
  values (nullif(trim(p_nome), ''), p_data, nullif(trim(p_local), ''))
  returning id into v_id;

  if v_id is null then
    raise exception 'Nome do evento é obrigatório';
  end if;

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

grant execute on function public.criar_evento(text, date, text) to anon;
