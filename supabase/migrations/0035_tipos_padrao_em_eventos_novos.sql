-- =============================================================================
-- 0035 — Tipos padrão (Convidado, Anfitrião, Acompanhante…) em TODO evento.
--
-- A 0018 semeou esses tipos só nos eventos que existiam naquele dia. Evento
-- criado depois nascia sem nenhum tipo; ao cadastrar o primeiro anfitrião, a
-- Gestão de anfitriões criava só o tipo "Anfitrião" — e o campo Tipo de
-- Participantes passava a mostrar apenas ele.
--
-- 1) completa os eventos que estão sem os tipos padrão (só adiciona o que
--    falta; não mexe em tipos que o cliente já criou/renomeou);
-- 2) todo evento novo já nasce com eles (trigger).
-- Idempotente.
-- =============================================================================
create or replace function public.semear_tipos_padrao(p_evento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_nome text;
begin
  foreach v_nome in array array['Convidado', 'Anfitrião', 'Acompanhante', 'Comprador', 'Membro', 'Outro'] loop
    if not exists (
      select 1 from public.grupos g
      where g.evento_id = p_evento and lower(g.nome) = lower(v_nome)
    ) then
      insert into public.grupos (evento_id, nome) values (p_evento, v_nome)
      on conflict do nothing;
    end if;
  end loop;
end $$;

revoke execute on function public.semear_tipos_padrao(uuid) from public, anon, authenticated;

create or replace function public.eventos_semear_tipos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.semear_tipos_padrao(new.id);
  return new;
end $$;

drop trigger if exists trg_eventos_semear_tipos on public.eventos;
create trigger trg_eventos_semear_tipos
  after insert on public.eventos
  for each row execute function public.eventos_semear_tipos();

-- eventos que já existem e estão sem os tipos padrão (ex.: criados depois da 0018)
do $$
declare v_evento uuid;
begin
  for v_evento in select id from public.eventos loop
    perform public.semear_tipos_padrao(v_evento);
  end loop;
end $$;
