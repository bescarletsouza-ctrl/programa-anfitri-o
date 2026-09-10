-- =============================================================================
-- 0012 — Tipos de ingresso (categorias de inscrição do evento).
--   Sem gateway de pagamento aqui: "preco" é texto livre ("Gratuito", "R$ 500").
--   O campo participantes.ingresso continua guardando o NOME do tipo.
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

create table if not exists public.tipos_ingresso (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  nome          text not null,
  preco         text,               -- livre: "Gratuito", "R$ 500,00"…
  vagas         int,                -- null = ilimitado
  inicio_vendas date,
  fim_vendas    date,
  ordem         int  not null default 0,
  ativo         boolean not null default true,
  oculto        boolean not null default false,   -- só via link direto
  -- configurações --------------------------------------------------------------
  lista_espera     boolean not null default false, -- ao lotar, novos vão p/ "Fila de espera"
  acesso_dias      text    not null default 'todos', -- 'todos' | 'um_dia'
  situacao_padrao  text    not null default 'Confirmado', -- situação de quem entra por este tipo
  max_por_compra   int     not null default 0,     -- 0 = sem limite
  pagina_inscritos boolean not null default false,
  termo            jsonb,                          -- { on, titulo, texto }
  created_at    timestamptz not null default now()
);

-- para quem já rodou a versão anterior desta migração
alter table public.tipos_ingresso
  add column if not exists lista_espera     boolean not null default false,
  add column if not exists acesso_dias      text    not null default 'todos',
  add column if not exists situacao_padrao  text    not null default 'Confirmado',
  add column if not exists max_por_compra   int     not null default 0,
  add column if not exists pagina_inscritos boolean not null default false,
  add column if not exists termo            jsonb;

create index if not exists tipos_ingresso_evento_idx on public.tipos_ingresso(evento_id, ordem);
create unique index if not exists tipos_ingresso_evento_nome_uidx
  on public.tipos_ingresso(evento_id, lower(nome));

alter table public.tipos_ingresso enable row level security;
drop policy if exists "anon full access" on public.tipos_ingresso;
create policy "anon full access" on public.tipos_ingresso for all to anon using (true) with check (true);
grant usage on schema public to anon;
grant select, insert, update, delete on public.tipos_ingresso to anon;

-- seed: cria um tipo para cada categoria já usada em participantes.ingresso
insert into public.tipos_ingresso (evento_id, nome)
select distinct p.evento_id, btrim(p.ingresso)
from public.participantes p
where coalesce(btrim(p.ingresso), '') <> ''
  and not exists (
    select 1 from public.tipos_ingresso t
    where t.evento_id = p.evento_id and lower(t.nome) = lower(btrim(p.ingresso))
  );
