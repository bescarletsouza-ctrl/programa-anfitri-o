-- =============================================================================
-- Programa Anfitrião — Fase 2: marcos/prêmios + ranking público
-- Rode este arquivo inteiro no SQL Editor do MESMO projeto Supabase do 0001.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Marcos da jornada do anfitrião (desbloqueados por nº de convidados confirmados).
-- Editável no admin (Configurações → Marcos).
-- -----------------------------------------------------------------------------
create table if not exists public.marcos (
  id         uuid primary key default gen_random_uuid(),
  quantidade int  not null,               -- confirmados necessários p/ desbloquear
  titulo     text not null,
  descricao  text,                         -- o prêmio / reconhecimento
  ordem      int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.marcos enable row level security;

drop policy if exists "anon full access" on public.marcos;
create policy "anon full access" on public.marcos
  for all to anon using (true) with check (true);

grant select, insert, update, delete on public.marcos to anon;

-- -----------------------------------------------------------------------------
-- View pública para o painel do anfitrião: só nome + grupo + nº de confirmados.
-- Não expõe e-mail/telefone (ao contrário de anfitrioes_com_stats).
-- -----------------------------------------------------------------------------
create or replace view public.ranking_publico as
select
  a.id,
  a.nome,
  a.slug,
  g.nome as grupo,
  coalesce(count(c.*) filter (where c.status = 'Confirmado'), 0) as confirmados
from public.anfitrioes a
left join public.convidados c on c.anfitriao_id = a.id
left join public.grupos g     on g.id = a.grupo_id
where a.vai is true
group by a.id, a.nome, a.slug, g.nome;

grant select on public.ranking_publico to anon;

-- -----------------------------------------------------------------------------
-- Seed: 3 marcos de exemplo (só se a tabela estiver vazia). Texto para editar.
-- -----------------------------------------------------------------------------
insert into public.marcos (quantidade, titulo, descricao, ordem)
select * from (values
  (3,  'Primeiro marco', 'Descreva aqui o reconhecimento ou brinde deste marco.', 1),
  (6,  'Segundo marco',  'Descreva aqui o reconhecimento ou brinde deste marco.', 2),
  (10, 'Terceiro marco', 'Descreva aqui o reconhecimento ou brinde deste marco.', 3)
) as v(quantidade, titulo, descricao, ordem)
where not exists (select 1 from public.marcos);
