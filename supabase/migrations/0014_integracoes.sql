-- =============================================================================
-- We.events — Integrações e Webhooks
-- Rode no SQL Editor do Supabase. Idempotente (pode rodar de novo).
--
-- integracoes: cada linha é uma integração do evento.
--   tipo = 'webhook_saida'  -> POST JSON para uma URL quando um gatilho ocorre
--   tipo = 'conector'       -> empurra dados para uma plataforma (ActiveCampaign,
--                              Z-API, etc.) usando as chaves em config
--   tipo = 'entrada'        -> o próprio evento recebe POSTs (ticketeira /
--                              gateway) na URL da função webhook-in, validado
--                              pelo token
-- webhook_entregas: log das tentativas de envio (saída/conector).
--
-- ATENÇÃO: enquanto o app não tiver login, config/segredo/token ficam
-- legíveis por quem tiver a URL + a chave pública. Coloque autenticação
-- antes de usar chaves de produção.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.integracoes (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  tipo        text not null default 'webhook_saida',
  nome        text not null,
  provedor    text not null default 'generico',
  url         text,
  eventos     text[] not null default '{}',          -- gatilhos assinados (vazio = todos)
  config      jsonb  not null default '{}'::jsonb,    -- chaves de API, ids de lista...
  segredo     text,                                   -- assina as entregas (HMAC SHA-256)
  token       text not null default encode(gen_random_bytes(18), 'hex'),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists integracoes_evento_idx on public.integracoes(evento_id, tipo);
create index if not exists integracoes_token_idx  on public.integracoes(token);

create table if not exists public.webhook_entregas (
  id            bigint generated always as identity primary key,
  integracao_id uuid references public.integracoes(id) on delete cascade,
  evento_id     uuid,
  gatilho       text,
  status        int,
  ok            boolean,
  erro          text,
  payload       jsonb,
  at            timestamptz not null default now()
);
create index if not exists webhook_entregas_integ_idx on public.webhook_entregas(integracao_id, at desc);
create index if not exists webhook_entregas_evento_idx on public.webhook_entregas(evento_id, at desc);

alter table public.integracoes      enable row level security;
alter table public.webhook_entregas enable row level security;

drop policy if exists "anon full access" on public.integracoes;
create policy "anon full access" on public.integracoes for all to anon using (true) with check (true);
drop policy if exists "anon full access" on public.webhook_entregas;
create policy "anon full access" on public.webhook_entregas for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.integracoes to anon;
grant select, insert, update, delete on public.webhook_entregas to anon;

-- limpa o log antigo automaticamente (mantém 30 dias) — chamado pela função
create or replace function public.limpar_webhook_entregas() returns void
language sql as $$
  delete from public.webhook_entregas where at < now() - interval '30 days';
$$;
