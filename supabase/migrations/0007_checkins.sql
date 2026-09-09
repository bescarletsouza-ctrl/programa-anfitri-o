-- =============================================================================
-- Programa Anfitrião — Histórico de check-in (entradas/saídas)
-- Cada credenciamento vira uma linha em public.checkins. participantes.presente
-- e participantes.checkin_at continuam como estado atual (o app mantém os dois
-- em sincronia). Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

create table if not exists public.checkins (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id)       on delete cascade,
  participante_id uuid not null references public.participantes(id) on delete cascade,
  acao            text not null default 'entrada' check (acao in ('entrada', 'saida')),
  at              timestamptz not null default now(),
  origem          text,
  created_at      timestamptz not null default now()
);

create index if not exists checkins_evento_at_idx    on public.checkins(evento_id, at desc);
create index if not exists checkins_participante_idx  on public.checkins(participante_id, at desc);

alter table public.checkins enable row level security;
drop policy if exists "anon full access" on public.checkins;
create policy "anon full access" on public.checkins for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.checkins to anon;
