-- =============================================================================
-- 0039 — Registra também a ENTRADA do card na etapa (quando ele é criado já
-- dentro de uma etapa), não só as movimentações. O prazo (SLA) conta a partir
-- de quando o card entrou na etapa atual; sem isso, quem foi cadastrado direto
-- na primeira etapa (importação, webhook, formulário) ficava sem data de
-- entrada. Idempotente.
--
-- Não há backfill: cards que já existiam antes da 0037 e nunca foram movidos
-- desde então não têm data de entrada conhecida — o prazo deles aparece como
-- "sem data de entrada" até a próxima movimentação.
-- =============================================================================
create or replace function public.log_entrada_participante()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.etapa_id is not null then
    insert into public.movimentacoes_pipeline (evento_id, registro_tipo, registro_id, de_nome, para_nome, em, user_id)
    values (
      new.evento_id, 'participante', new.id, null,
      coalesce((select nome from public.etapas_participante where id = new.etapa_id), 'Sem etapa'),
      coalesce(new.created_at, now()), auth.uid()
    );
  end if;
  return new;
end $$;

create or replace function public.log_entrada_anfitriao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estagio_id is not null then
    insert into public.movimentacoes_pipeline (evento_id, registro_tipo, registro_id, de_nome, para_nome, em, user_id)
    values (
      new.evento_id, 'anfitriao', new.id, null,
      coalesce((select nome from public.estagios where id = new.estagio_id), 'Sem estágio'),
      coalesce(new.created_at, now()), auth.uid()
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_log_entrada_participante on public.participantes;
create trigger trg_log_entrada_participante after insert on public.participantes
  for each row execute function public.log_entrada_participante();

drop trigger if exists trg_log_entrada_anfitriao on public.anfitrioes;
create trigger trg_log_entrada_anfitriao after insert on public.anfitrioes
  for each row execute function public.log_entrada_anfitriao();
