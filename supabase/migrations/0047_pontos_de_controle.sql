-- =============================================================================
-- 0047 — Pontos de controle de acesso (plenária, foyer, sala VIP…).
--
-- O operador cadastra os locais no app de check-in (Configurações ▸ Pontos de controle) e, na aba
-- "Controle de acesso", lê o QR do crachá registrando ENTRADA ou SAÍDA naquele local — o objetivo é
-- contar quantas pessoas estão dentro de cada espaço. É separado do check-in do evento (tabela
-- `checkins`) e do check-in de atividade: não mexe em "presente" do participante.
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

create table if not exists public.pontos_controle (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  nome       text not null,
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists pontos_controle_evento_idx on public.pontos_controle(evento_id, ordem);

create table if not exists public.acessos_pontos (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id)        on delete cascade,
  ponto_id        uuid not null references public.pontos_controle(id) on delete cascade,
  participante_id uuid not null references public.participantes(id)   on delete cascade,
  acao            text not null check (acao in ('entrada', 'saida')),
  operador        text,
  at              timestamptz not null default now()
);
create index if not exists acessos_pontos_ponto_idx  on public.acessos_pontos(ponto_id, at desc);
create index if not exists acessos_pontos_evento_idx on public.acessos_pontos(evento_id, at desc);
create index if not exists acessos_pontos_part_idx   on public.acessos_pontos(participante_id);

do $$
declare t text;
begin
  foreach t in array array['pontos_controle', 'acessos_pontos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "escopo da org" on public.%I;', t);
    execute format(
      'create policy "escopo da org" on public.%I for all to authenticated
         using (public.evento_visivel(evento_id))
         with check (public.evento_visivel(evento_id));', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;
