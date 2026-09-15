-- =============================================================================
-- 0030 — Campos personalizados por evento (texto / única escolha / múltipla
-- escolha), configurados na tela "Tipos de ingresso". As respostas de cada
-- participante ficam em participantes.campos_extra (jsonb: { chave: valor }),
-- onde valor é string (texto/única escolha) ou array de strings (múltipla).
--
-- Segue o mesmo padrão de RLS das tabelas escopadas por evento (0017).
-- =============================================================================
begin;

create table if not exists public.campos_personalizados (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nome        text not null,
  chave       text not null,
  tipo        text not null default 'texto',        -- 'texto' | 'unica_escolha' | 'multipla_escolha'
  opcoes      jsonb not null default '[]'::jsonb,    -- array de strings (só p/ escolha)
  ordem       int not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (evento_id, chave)
);
create index if not exists campos_personalizados_evento_idx on public.campos_personalizados(evento_id);

alter table public.campos_personalizados enable row level security;
drop policy if exists "escopo da org" on public.campos_personalizados;
create policy "escopo da org" on public.campos_personalizados for all to authenticated
  using (public.evento_visivel(evento_id))
  with check (public.evento_visivel(evento_id));
revoke all on public.campos_personalizados from anon;

alter table public.participantes
  add column if not exists campos_extra jsonb not null default '{}'::jsonb;

commit;
