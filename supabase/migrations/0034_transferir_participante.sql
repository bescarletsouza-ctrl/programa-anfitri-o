-- =============================================================================
-- 0034 — Transferir participante para outro evento (só eventos ativos),
-- mantendo a origem.
--
-- O participante É MOVIDO (muda o evento_id) e leva junto tudo que é dele:
-- tipo, ingresso, pagamento, faturamento, empresa, responsável, observação,
-- campos personalizados, vínculo com o convite. O que identifica a origem
-- fica guardado nas colunas novas (evento/código de origem) e o código do
-- participante (ex.: o código da mesa) é mantido no evento novo — só é
-- trocado se já existir alguém com o mesmo código lá, e nesse caso o
-- original continua em codigo_origem.
--
-- Evento "ativo" = eventos.ativo não é false E a data do evento (se tiver)
-- ainda não passou.
--
-- Roda com a permissão de quem chama (security invoker): a RLS por
-- organização continua valendo — só dá pra transferir entre eventos que o
-- usuário enxerga. Idempotente.
-- =============================================================================
alter table public.participantes
  add column if not exists evento_origem_id   uuid references public.eventos(id) on delete set null,
  add column if not exists evento_origem_nome text,
  add column if not exists codigo_origem      text,
  add column if not exists transferido_em     timestamptz;

create or replace function public.transferir_participantes(p_ids uuid[], p_evento_destino uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dest   record;
  v_etapa  uuid;
  r        record;
  v_cod    text;
  v_n      int;
  v_pref   text;
  v_ok     int := 0;
  v_anf    int := 0;
  v_mesmo  int := 0;
begin
  select id, nome, ativo, data_evento into v_dest
    from public.eventos where id = p_evento_destino;
  if not found then
    raise exception 'Evento de destino não encontrado.';
  end if;
  if v_dest.ativo is false
     or (v_dest.data_evento is not null
         and v_dest.data_evento < (now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'O evento de destino não está ativo.';
  end if;

  select id into v_etapa from public.etapas_participante
   where evento_id = p_evento_destino order by ordem limit 1;

  for r in
    select p.*, e.nome as nome_evento_atual
      from public.participantes p
      join public.eventos e on e.id = p.evento_id
     where p.id = any(p_ids)
     order by p.created_at, p.id
  loop
    if r.evento_id = p_evento_destino then v_mesmo := v_mesmo + 1; continue; end if;
    -- anfitrião é gerido na Gestão de anfitriões (o registro dele é do evento de origem)
    if r.anfitriao_id is not null then v_anf := v_anf + 1; continue; end if;

    v_cod := r.codigo;
    if v_cod is null or btrim(v_cod) = ''
       or exists (select 1 from public.participantes
                   where evento_id = p_evento_destino and codigo = v_cod) then
      update public.eventos
         set proximo_codigo = proximo_codigo + 1
       where id = p_evento_destino
      returning proximo_codigo - 1, public.prefixo_evento(nome) into v_n, v_pref;
      v_cod := v_pref || '-' || lpad(v_n::text, 4, '0');
    end if;

    update public.participantes set
      evento_id          = p_evento_destino,
      codigo             = v_cod,
      etapa_id           = v_etapa,        -- as etapas são de cada evento: entra na primeira do novo
      presente           = false,          -- check-in é por evento
      checkin_at         = null,
      -- a origem é sempre a primeira (transferir de novo não apaga o histórico)
      evento_origem_id   = coalesce(r.evento_origem_id, r.evento_id),
      evento_origem_nome = coalesce(r.evento_origem_nome, r.nome_evento_atual),
      codigo_origem      = coalesce(r.codigo_origem, r.codigo),
      transferido_em     = now()
    where id = r.id;
    v_ok := v_ok + 1;
  end loop;

  return jsonb_build_object(
    'transferidos', v_ok,
    'ignorados_anfitriao', v_anf,
    'ignorados_mesmo_evento', v_mesmo
  );
end $$;

revoke execute on function public.transferir_participantes(uuid[], uuid) from public, anon;
grant  execute on function public.transferir_participantes(uuid[], uuid) to authenticated;
