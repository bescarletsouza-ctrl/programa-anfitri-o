-- =============================================================================
-- 0037 — Histórico de movimentações no pipeline (Participantes e Anfitriões).
--
-- Toda vez que a etapa/estágio de um participante ou anfitrião muda, grava
-- quando, de qual etapa pra qual e quem mexeu. É feito por trigger, então
-- pega qualquer caminho: arrastar o card, select do card, edição na lista,
-- ação em massa, gaveta, importação, webhook, transferência de evento.
-- O card mostra a última movimentação; a gaveta mostra o histórico.
-- Os nomes das etapas ficam gravados (o histórico sobrevive se a etapa for
-- renomeada ou excluída). Idempotente.
-- =============================================================================
create table if not exists public.movimentacoes_pipeline (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  registro_tipo text not null check (registro_tipo in ('participante', 'anfitriao')),
  registro_id   uuid not null,
  de_nome       text,
  para_nome     text,
  em            timestamptz not null default now(),
  user_id       uuid
);
create index if not exists movimentacoes_registro_idx
  on public.movimentacoes_pipeline(registro_tipo, registro_id, em desc);
create index if not exists movimentacoes_evento_idx
  on public.movimentacoes_pipeline(evento_id, registro_tipo);

alter table public.movimentacoes_pipeline enable row level security;
drop policy if exists "movimentacoes da org" on public.movimentacoes_pipeline;
create policy "movimentacoes da org" on public.movimentacoes_pipeline
  for select to authenticated using (public.evento_visivel(evento_id));
revoke all on public.movimentacoes_pipeline from anon;
grant select on public.movimentacoes_pipeline to authenticated;

-- participante: etapa_id mudou
create or replace function public.log_mov_participante()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.etapa_id is distinct from old.etapa_id then
    -- etapa excluída (FK "on delete set null"): não é uma movimentação de ninguém
    if new.etapa_id is null and not exists (select 1 from public.etapas_participante where id = old.etapa_id) then
      return new;
    end if;
    insert into public.movimentacoes_pipeline (evento_id, registro_tipo, registro_id, de_nome, para_nome, user_id)
    values (
      new.evento_id, 'participante', new.id,
      coalesce((select nome from public.etapas_participante where id = old.etapa_id), 'Sem etapa'),
      coalesce((select nome from public.etapas_participante where id = new.etapa_id), 'Sem etapa'),
      auth.uid()
    );
  end if;
  return new;
end $$;

-- anfitrião: estagio_id mudou
create or replace function public.log_mov_anfitriao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estagio_id is distinct from old.estagio_id then
    if new.estagio_id is null and not exists (select 1 from public.estagios where id = old.estagio_id) then
      return new;
    end if;
    insert into public.movimentacoes_pipeline (evento_id, registro_tipo, registro_id, de_nome, para_nome, user_id)
    values (
      new.evento_id, 'anfitriao', new.id,
      coalesce((select nome from public.estagios where id = old.estagio_id), 'Sem estágio'),
      coalesce((select nome from public.estagios where id = new.estagio_id), 'Sem estágio'),
      auth.uid()
    );
  end if;
  return new;
end $$;

-- ao excluir o registro, leva o histórico dele junto
create or replace function public.limpa_mov_registro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.movimentacoes_pipeline
   where registro_tipo = tg_argv[0] and registro_id = old.id;
  return old;
end $$;

drop trigger if exists trg_log_mov_participante on public.participantes;
create trigger trg_log_mov_participante after update of etapa_id on public.participantes
  for each row execute function public.log_mov_participante();

drop trigger if exists trg_log_mov_anfitriao on public.anfitrioes;
create trigger trg_log_mov_anfitriao after update of estagio_id on public.anfitrioes
  for each row execute function public.log_mov_anfitriao();

drop trigger if exists trg_limpa_mov_participante on public.participantes;
create trigger trg_limpa_mov_participante after delete on public.participantes
  for each row execute function public.limpa_mov_registro('participante');

drop trigger if exists trg_limpa_mov_anfitriao on public.anfitrioes;
create trigger trg_limpa_mov_anfitriao after delete on public.anfitrioes
  for each row execute function public.limpa_mov_registro('anfitriao');

-- última movimentação de cada registro do evento, num único JSON
-- { "<registro_id>": { "de": "...", "para": "...", "em": "..." } } — sem o
-- limite de linhas do PostgREST. Roda com a RLS de quem chama.
create or replace function public.ultimas_movimentacoes(p_evento uuid, p_tipo text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(x.registro_id, jsonb_build_object('de', x.de_nome, 'para', x.para_nome, 'em', x.em)),
    '{}'::jsonb)
  from (
    select distinct on (m.registro_id) m.registro_id, m.de_nome, m.para_nome, m.em
      from public.movimentacoes_pipeline m
     where m.evento_id = p_evento and m.registro_tipo = p_tipo
     order by m.registro_id, m.em desc
  ) x;
$$;

revoke execute on function public.ultimas_movimentacoes(uuid, text) from public, anon;
grant  execute on function public.ultimas_movimentacoes(uuid, text) to authenticated;
