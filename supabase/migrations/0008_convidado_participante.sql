-- =============================================================================
-- Programa Anfitrião — Convidado aprovado vira Participante + crachá configurável
--  * anfitrioes.categoria_convidado : categoria que os convidados desse anfitrião
--    herdam ao serem aprovados
--  * participantes.convidado_id      : vínculo com o convidado de origem
--  * eventos.cracha_config           : layout/tamanho do crachá (JSON)
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

alter table public.anfitrioes
  add column if not exists categoria_convidado text;

alter table public.participantes
  add column if not exists convidado_id uuid references public.convidados(id) on delete set null;

create unique index if not exists participantes_convidado_uidx
  on public.participantes(convidado_id) where convidado_id is not null;

alter table public.eventos
  add column if not exists cracha_config jsonb;

-- -----------------------------------------------------------------------------
-- Backfill: convidados já aprovados/confirmados que ainda não têm participante
-- -----------------------------------------------------------------------------
insert into public.participantes (evento_id, nome, email, telefone, empresa, tipo, pagamento, ingresso, convidado_id)
select
  c.evento_id,
  c.nome,
  c.email,
  c.telefone,
  c.empresa,
  'Convidado',
  'Convidado',
  a.categoria_convidado,
  c.id
from public.convidados c
left join public.anfitrioes a on a.id = c.anfitriao_id
where c.status in ('Aprovado', 'Confirmado')
  and not exists (select 1 from public.participantes p where p.convidado_id = c.id);
