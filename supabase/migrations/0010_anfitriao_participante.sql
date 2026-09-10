-- =============================================================================
-- 0010 — Sincronismo Anfitrião <-> Participante (chave: e-mail)
--  * participante com tipo = 'Anfitrião'      -> aparece também na aba Anfitriões
--  * anfitrião com "vai ao evento" (vai=true) -> aparece também em Participantes
--  * vínculo 1-para-1 (anfitrioes.participante_id / participantes.anfitriao_id)
--  * origem_* marca quem foi criado automaticamente (só esses são removidos ao
--    desfazer a condição)
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas novas (sem os índices únicos ainda — os dados podem ter duplicata)
-- -----------------------------------------------------------------------------
alter table public.anfitrioes
  add column if not exists participante_id uuid references public.participantes(id) on delete set null,
  add column if not exists origem_participante boolean not null default false;

alter table public.participantes
  add column if not exists origem_anfitriao boolean not null default false;

-- a view expande a.* na criação; recriar para incluir as colunas novas
drop view if exists public.anfitrioes_com_stats;
create view public.anfitrioes_com_stats as
select
  a.*,
  coalesce(c.enviados, 0)    as enviados,
  coalesce(c.aprovados, 0)   as aprovados,
  coalesce(c.confirmados, 0) as confirmados
from public.anfitrioes a
left join (
  select anfitriao_id,
    count(*)                                                     as enviados,
    count(*) filter (where status in ('Aprovado', 'Confirmado')) as aprovados,
    count(*) filter (where status = 'Confirmado')                as confirmados
  from public.convidados
  group by anfitriao_id
) c on c.anfitriao_id = a.id;
grant select on public.anfitrioes_com_stats to anon;

-- -----------------------------------------------------------------------------
-- 2. Limpa vínculos antigos: se vários participantes apontam para o mesmo
--    anfitrião (o código antigo não tinha índice único), mantém 1 e solta o resto
-- -----------------------------------------------------------------------------
with ranked as (
  select id,
    row_number() over (
      partition by anfitriao_id
      order by (tipo = 'Anfitrião') desc, created_at asc, id asc
    ) as rn
  from public.participantes
  where anfitriao_id is not null
)
update public.participantes p
set anfitriao_id = null
from ranked
where p.id = ranked.id and ranked.rn > 1;

-- reverse-link: preenche anfitrioes.participante_id a partir do que sobrou
update public.anfitrioes a
set participante_id = p.id
from public.participantes p
where p.anfitriao_id = a.id and a.participante_id is null;

-- -----------------------------------------------------------------------------
-- 3. Backfill nos dois sentidos
-- -----------------------------------------------------------------------------
do $$
declare r record; v_id uuid;
begin
  -- participante Anfitrião sem vínculo  ->  anfitrião (casa por e-mail / cria)
  for r in select * from public.participantes p
           where p.tipo = 'Anfitrião' and p.anfitriao_id is null loop
    v_id := null;
    if r.email is not null and btrim(r.email) <> '' then
      select a.id into v_id from public.anfitrioes a
        where a.evento_id = r.evento_id
          and lower(a.email) = lower(r.email)
          and a.participante_id is null
        limit 1;
    end if;
    if v_id is null then
      insert into public.anfitrioes (evento_id, nome, email, telefone, tipo, vai, participante_id, origem_participante)
      values (r.evento_id, r.nome, r.email, r.telefone, 'Titular', true, r.id, true)
      returning id into v_id;
    else
      update public.anfitrioes set participante_id = r.id, vai = true where id = v_id;
    end if;
    update public.participantes set anfitriao_id = v_id where id = r.id;
  end loop;

  -- anfitrião vai=true sem participante  ->  participante (casa por e-mail / cria)
  for r in select * from public.anfitrioes a
           where a.vai is true and a.participante_id is null loop
    v_id := null;
    if r.email is not null and btrim(r.email) <> '' then
      select p.id into v_id from public.participantes p
        where p.evento_id = r.evento_id
          and lower(p.email) = lower(r.email)
          and p.anfitriao_id is null
        limit 1;
    end if;
    if v_id is null then
      insert into public.participantes (evento_id, nome, email, telefone, tipo, pagamento, anfitriao_id, origem_anfitriao)
      values (r.evento_id, r.nome, r.email, r.telefone, 'Anfitrião', 'Gratuito', r.id, true)
      returning id into v_id;
    else
      update public.participantes set anfitriao_id = r.id, tipo = 'Anfitrião' where id = v_id;
    end if;
    update public.anfitrioes set participante_id = v_id where id = r.id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Agora os dados estão 1-para-1 — cria os índices únicos parciais
-- -----------------------------------------------------------------------------
create unique index if not exists anfitrioes_participante_uidx
  on public.anfitrioes(participante_id) where participante_id is not null;
create unique index if not exists participantes_anfitriao_uidx
  on public.participantes(anfitriao_id) where anfitriao_id is not null;
