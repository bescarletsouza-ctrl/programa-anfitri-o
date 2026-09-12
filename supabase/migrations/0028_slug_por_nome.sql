-- =============================================================================
-- 0028 — Link de convite curto e com o nome do anfitrião. Até aqui o "slug"
-- era um UUID de 32 caracteres sem sentido (ex.: 977a7b77a1764599acd126580c78fc15).
-- Passa a ser "primeironome-sobrenome-xxxx" (sem os nomes do meio; xxxx = 4
-- caracteres pra evitar colisão, já que o slug é único no banco). A aplicação
-- já gera slugs nesse formato para anfitriões novos; esta migração atualiza
-- os que já existem.
--
-- ATENÇÃO: isso troca o slug de todo mundo que já tinha um link de convite
-- gerado — qualquer link antigo já compartilhado com convidados para de
-- funcionar. Rode só quando estiver certo de que quer isso.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem duplicar sufixo
-- (só atualiza quem ainda não está no formato novo).
-- =============================================================================

create extension if not exists unaccent;

create or replace function public.slugify_nome(txt text) returns text
language sql immutable as $$
  select trim(both '_' from
    regexp_replace(lower(unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '_', 'g')
  );
$$;

-- primeiro nome + último nome (sem os do meio) — mesma regra do gerarSlugAnfitriao() do app
create or replace function public.nome_curto_slug(txt text) returns text
language sql immutable as $$
  select case
    when cardinality(p) > 1 then p[1] || ' ' || p[cardinality(p)]
    else p[1]
  end
  from (select regexp_split_to_array(trim(coalesce(txt, '')), '\s+') as p) x;
$$;

with base as (
  select id, coalesce(nullif(public.slugify_nome(public.nome_curto_slug(nome)), ''), 'convidado') as raiz,
         lower(substr(md5(id::text), 1, 4)) as sufixo
  from public.anfitrioes
)
update public.anfitrioes a
set slug = base.raiz || '-' || base.sufixo
from base
where a.id = base.id
  and a.slug !~ ('^' || base.raiz || '-[a-z0-9]{4}$');
