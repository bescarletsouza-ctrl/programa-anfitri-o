-- =============================================================================
-- 0009 — Atividades / controle de acesso por sessão.
-- Cada atividade tem horário, vagas e categorias liberadas. O check-in por
-- atividade reusa a tabela `checkins` (coluna nova `atividade_id`; null = o
-- check-in geral do evento, como já era).
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

create table if not exists public.atividades (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nome        text not null,
  dia         date,
  inicio      text,                          -- 'HH:MM'
  fim         text,                          -- 'HH:MM'
  vagas       int,                           -- null = ilimitado
  categorias  text[] not null default '{}',  -- ingressos liberados; vazio = todas
  ordem       int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists atividades_evento_idx on public.atividades(evento_id, dia, inicio);

-- check-in por atividade: null = credenciamento geral do evento.
alter table public.checkins add column if not exists atividade_id uuid
  references public.atividades(id) on delete cascade;
create index if not exists checkins_atividade_idx on public.checkins(atividade_id, at desc);

alter table public.atividades enable row level security;
drop policy if exists "anon full access" on public.atividades;
create policy "anon full access" on public.atividades for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.atividades to anon;
