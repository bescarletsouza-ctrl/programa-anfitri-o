-- =============================================================================
-- 0048 — Lista de inscritos por atividade.
--
-- Até aqui a atividade só tinha "categorias liberadas" e vagas. Agora cada atividade tem a sua
-- lista de INSCRITOS: o operador adiciona pessoas lendo o QR do crachá (com ou sem já fazer o
-- check-in) ou pesquisando por nome / e-mail / telefone / CPF, direto no app de check-in.
-- A entrada e a saída continuam na tabela `checkins` (coluna atividade_id); esta tabela só diz
-- QUEM está inscrito em QUÊ.
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

create table if not exists public.atividade_inscritos (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id)        on delete cascade,
  atividade_id    uuid not null references public.atividades(id)     on delete cascade,
  participante_id uuid not null references public.participantes(id)  on delete cascade,
  operador        text,
  created_at      timestamptz not null default now(),
  unique (atividade_id, participante_id)
);
create index if not exists atividade_inscritos_ativ_idx on public.atividade_inscritos(atividade_id);
create index if not exists atividade_inscritos_part_idx on public.atividade_inscritos(participante_id);
create index if not exists atividade_inscritos_evento_idx on public.atividade_inscritos(evento_id);

alter table public.atividade_inscritos enable row level security;
drop policy if exists "escopo da org" on public.atividade_inscritos;
create policy "escopo da org" on public.atividade_inscritos for all to authenticated
  using (public.evento_visivel(evento_id))
  with check (public.evento_visivel(evento_id));
revoke all on public.atividade_inscritos from anon;
grant select, insert, update, delete on public.atividade_inscritos to authenticated;
