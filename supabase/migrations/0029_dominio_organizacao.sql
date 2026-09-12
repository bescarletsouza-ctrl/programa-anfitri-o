-- =============================================================================
-- 0029 — Domínio personalizado por organização. A super-admin cadastra um
-- domínio próprio (ex.: we.events.nitro10x.com.br) pra uma organização em
-- Plataforma → editar organização; os links de convite/painel gerados pelos
-- anfitriões dessa organização passam a usar esse domínio em vez do domínio
-- padrão da plataforma.
--
-- Isso só troca a URL usada nos links gerados pelo app — o domínio em si
-- precisa ser adicionado manualmente no projeto da Vercel (Settings →
-- Domains) e ter o DNS apontado pra lá; sem isso o domínio não resolve.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.organizacoes add column if not exists dominio text;

-- Sem "www.", sem "https://", sem barra final — normaliza o que já tiver.
update public.organizacoes
set dominio = nullif(trim(both '/' from regexp_replace(lower(trim(dominio)), '^https?://(www\.)?', '')), '')
where dominio is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizacoes_dominio_key'
  ) then
    alter table public.organizacoes add constraint organizacoes_dominio_key unique (dominio);
  end if;
end $$;
