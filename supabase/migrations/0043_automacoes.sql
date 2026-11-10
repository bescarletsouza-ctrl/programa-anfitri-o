-- =============================================================================
-- 0043 — Automações (regras "quando… se… então…") sobre participantes.
--
-- Cada automação é do evento e tem:
--   gatilho   'criado' = só quando o participante é criado;
--             'atende' = quando é criado OU passa a atender as condições
--   condicoes [{campo, op, valor}]    (todas precisam valer)
--   acoes     [{tipo, ...}]           responsavel | responsavel_rodizio | etapa
--                                     | situacao | ingresso | tipo
--   parar     se verdadeiro, as automações seguintes não rodam nesse participante
-- Roda por TRIGGER no banco, então vale pra qualquer entrada: cadastro manual,
-- importação, webhook (Guru etc.), convite aprovado, edição na tela.
-- Uma regra com defeito NUNCA impede salvar o participante (erro vira aviso).
-- Idempotente.
-- =============================================================================
create table if not exists public.automacoes (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  nome          text not null,
  ativo         boolean not null default true,
  gatilho       text not null default 'atende' check (gatilho in ('criado', 'atende')),
  condicoes     jsonb not null default '[]'::jsonb,
  acoes         jsonb not null default '[]'::jsonb,
  parar         boolean not null default false,
  ordem         int not null default 0,
  created_at    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists automacoes_evento_idx on public.automacoes(evento_id, ordem);

-- histórico do que cada regra fez (pra explicar "por que esse participante ficou com X?")
create table if not exists public.automacao_execucoes (
  id              bigint generated always as identity primary key,
  automacao_id    uuid not null references public.automacoes(id) on delete cascade,
  evento_id       uuid not null,
  participante_id uuid,
  em              timestamptz not null default now(),
  origem          text not null default 'automatico',   -- automatico | retroativo
  mudancas        jsonb not null default '{}'::jsonb    -- { campo: { de, para } }
);
create index if not exists automacao_exec_regra_idx on public.automacao_execucoes(automacao_id, em desc);
create index if not exists automacao_exec_evento_idx on public.automacao_execucoes(evento_id, em desc);

alter table public.automacoes          enable row level security;
alter table public.automacao_execucoes enable row level security;

drop policy if exists "escopo da org" on public.automacoes;
create policy "escopo da org" on public.automacoes for all to authenticated
  using (public.evento_visivel(evento_id)) with check (public.evento_visivel(evento_id));
drop policy if exists "execucoes da org" on public.automacao_execucoes;
create policy "execucoes da org" on public.automacao_execucoes for select to authenticated
  using (public.evento_visivel(evento_id));

revoke all on public.automacoes, public.automacao_execucoes from anon;
grant select, insert, update, delete on public.automacoes to authenticated;
grant select on public.automacao_execucoes to authenticated;

create or replace function public.automacoes_touch()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists trg_automacoes_touch on public.automacoes;
create trigger trg_automacoes_touch before update on public.automacoes
  for each row execute function public.automacoes_touch();

-- -----------------------------------------------------------------------------
-- Comparação sem acento/maiúscula
-- -----------------------------------------------------------------------------
create or replace function public.auto_norm(t text)
returns text language sql immutable as $$
  select translate(lower(btrim(coalesce(t, ''))), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
$$;

-- -----------------------------------------------------------------------------
-- Todas as condições valem pra esta linha (jsonb do participante)?
-- Lista vazia = vale sempre. Campo/operador desconhecido = a regra não vale.
-- -----------------------------------------------------------------------------
create or replace function public.auto_cond_ok(p_conds jsonb, p_linha jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  c jsonb; campo text; op text; atual text; alvo text; achou boolean; lista jsonb;
  campos_ok text[] := array['tipo','ingresso','situacao','pagamento','etapa_id','faturamento','empresa',
                            'email','telefone','convidado_id','anfitriao_id','responsavel_user_id'];
begin
  if p_conds is null or jsonb_typeof(p_conds) <> 'array' then return false; end if;
  for c in select * from jsonb_array_elements(p_conds) loop
    campo := c->>'campo';
    op    := c->>'op';
    if campo is null or not (campo = any(campos_ok)) then return false; end if;
    atual := nullif(btrim(p_linha->>campo), '');
    alvo  := c->>'valor';

    if op = 'vazio' then
      if atual is not null then return false; end if;
    elsif op = 'preenchido' then
      if atual is null then return false; end if;
    elsif op = 'igual' then
      if public.auto_norm(atual) <> public.auto_norm(alvo) then return false; end if;
    elsif op = 'diferente' then
      if public.auto_norm(atual) = public.auto_norm(alvo) then return false; end if;
    elsif op = 'em' then
      lista := case when jsonb_typeof(c->'valor') = 'array' then c->'valor' else '[]'::jsonb end;
      select exists (
        select 1 from jsonb_array_elements_text(lista) v where public.auto_norm(v) = public.auto_norm(atual)
      ) into achou;
      if not achou then return false; end if;
    elsif op = 'contem' then
      if coalesce(btrim(alvo), '') = '' or position(public.auto_norm(alvo) in public.auto_norm(atual)) = 0 then return false; end if;
    elsif op = 'nao_contem' then
      if coalesce(btrim(alvo), '') <> '' and position(public.auto_norm(alvo) in public.auto_norm(atual)) > 0 then return false; end if;
    elsif op = 'comeca' then
      if coalesce(btrim(alvo), '') = ''
         or left(public.auto_norm(atual), length(public.auto_norm(alvo))) <> public.auto_norm(alvo) then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end $$;

-- -----------------------------------------------------------------------------
-- Aplica as ações numa linha de participante e devolve a linha alterada.
-- VOLATILE de propósito: o rodízio precisa enxergar os participantes que a
-- própria importação já inseriu (senão todo mundo cairia no mesmo responsável).
-- -----------------------------------------------------------------------------
create or replace function public.auto_aplicar_acoes(p_acoes jsonb, p_evento uuid, p_r public.participantes)
returns public.participantes
language plpgsql
set search_path = public
as $$
declare
  r public.participantes := p_r;
  a jsonb; kind text; v uuid; s text; so_vazio boolean;
begin
  if p_acoes is null or jsonb_typeof(p_acoes) <> 'array' then return r; end if;
  for a in select * from jsonb_array_elements(p_acoes) loop
    kind := a->>'tipo';
    so_vazio := coalesce((a->>'somente_se_vazio')::boolean, true);

    if kind = 'responsavel' then
      if r.responsavel_user_id is null or not so_vazio then
        v := nullif(a->>'usuario', '')::uuid;
        if v is not null then r.responsavel_user_id := v; end if;
      end if;

    elsif kind = 'responsavel_rodizio' then
      -- quem tem MENOS participantes sob responsabilidade neste evento; empate: ordem da lista
      if r.responsavel_user_id is null or not so_vazio then
        v := null;
        select l.u into v
          from (select u::uuid as u, o
                  from jsonb_array_elements_text(coalesce(a->'usuarios', '[]'::jsonb)) with ordinality t(u, o)) l
         order by (select count(*) from public.participantes x
                    where x.evento_id = p_evento and x.responsavel_user_id = l.u), l.o
         limit 1;
        if v is not null then r.responsavel_user_id := v; end if;
      end if;

    elsif kind = 'etapa' then
      v := nullif(a->>'etapa_id', '')::uuid;
      if v is not null and exists (select 1 from public.etapas_participante e where e.id = v and e.evento_id = p_evento) then
        r.etapa_id := v;
      end if;

    elsif kind = 'situacao' then
      s := a->>'valor';
      if s in ('Confirmado', 'Pendente', 'Fila de espera', 'Pré-inscrito', 'Desativado') then r.situacao := s; end if;

    elsif kind = 'ingresso' then
      s := nullif(btrim(a->>'valor'), '');
      if s is not null then r.ingresso := s; end if;

    elsif kind = 'tipo' then
      s := nullif(btrim(a->>'valor'), '');
      if s is not null then r.tipo := s; end if;
    end if;
  end loop;
  return r;
end $$;

-- { campo: { de, para } } só do que mudou
create or replace function public.auto_diff(p_antes jsonb, p_depois jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('de', p_antes->e.key, 'para', e.value)), '{}'::jsonb)
    from jsonb_each(p_depois) e
   where p_antes->e.key is distinct from e.value;
$$;

-- -----------------------------------------------------------------------------
-- O trigger. Nome começa com "trg_a…" pra rodar ANTES do trg_participantes_*.
-- -----------------------------------------------------------------------------
create or replace function public.automacoes_participante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  r public.participantes := new;
  antes public.participantes;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return new; end if;
  if not exists (select 1 from public.automacoes where evento_id = new.evento_id and ativo) then return new; end if;

  begin
    for a in
      select * from public.automacoes
       where evento_id = new.evento_id and ativo
       order by ordem, created_at
    loop
      if tg_op = 'INSERT' then
        if not public.auto_cond_ok(a.condicoes, to_jsonb(r)) then continue; end if;
      else
        -- alteração: só quando PASSA a atender (não reaplica a cada edição, e não
        -- briga com o que a pessoa ajustou à mão)
        if a.gatilho = 'criado' then continue; end if;
        if not public.auto_cond_ok(a.condicoes, to_jsonb(r)) then continue; end if;
        if public.auto_cond_ok(a.condicoes, to_jsonb(old)) then continue; end if;
      end if;

      antes := r;
      r := public.auto_aplicar_acoes(a.acoes, new.evento_id, r);
      if to_jsonb(r) is distinct from to_jsonb(antes) then
        insert into public.automacao_execucoes (automacao_id, evento_id, participante_id, mudancas)
        values (a.id, new.evento_id, r.id, public.auto_diff(to_jsonb(antes), to_jsonb(r)));
      end if;
      if a.parar then exit; end if;
    end loop;

    if random() < 0.01 then
      delete from public.automacao_execucoes where em < now() - interval '90 days';
    end if;
  exception when others then
    raise warning 'automacoes_participante: %', sqlerrm;
    return new;
  end;

  return r;
end $$;

drop trigger if exists trg_automacoes_participante on public.participantes;
create trigger trg_automacoes_participante
  before insert or update on public.participantes
  for each row execute function public.automacoes_participante();

-- -----------------------------------------------------------------------------
-- Pra tela: prévia (quantos atendem / quantos mudariam), aplicar nos existentes
-- e estatísticas. Conferem o acesso ao evento (evento_visivel).
-- -----------------------------------------------------------------------------
create or replace function public.automacao_preview(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.automacoes; p public.participantes; r public.participantes; atendem int := 0; mudariam int := 0;
begin
  select * into a from public.automacoes where id = p_id;
  if not found then raise exception 'Automação não encontrada.'; end if;
  if not public.evento_visivel(a.evento_id) then raise exception 'Sem acesso a este evento.'; end if;
  for p in select * from public.participantes where evento_id = a.evento_id loop
    if public.auto_cond_ok(a.condicoes, to_jsonb(p)) then
      atendem := atendem + 1;
      r := public.auto_aplicar_acoes(a.acoes, a.evento_id, p);
      if to_jsonb(r) is distinct from to_jsonb(p) then mudariam := mudariam + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('atendem', atendem, 'mudariam', mudariam);
end $$;

create or replace function public.automacao_aplicar_existentes(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.automacoes; p public.participantes; r public.participantes; n int := 0;
begin
  select * into a from public.automacoes where id = p_id;
  if not found then raise exception 'Automação não encontrada.'; end if;
  if not public.evento_visivel(a.evento_id) then raise exception 'Sem acesso a este evento.'; end if;
  for p in select * from public.participantes where evento_id = a.evento_id order by created_at loop
    if public.auto_cond_ok(a.condicoes, to_jsonb(p)) then
      r := public.auto_aplicar_acoes(a.acoes, a.evento_id, p);
      if to_jsonb(r) is distinct from to_jsonb(p) then
        update public.participantes
           set tipo = r.tipo, ingresso = r.ingresso, situacao = r.situacao,
               etapa_id = r.etapa_id, responsavel_user_id = r.responsavel_user_id
         where id = p.id;
        insert into public.automacao_execucoes (automacao_id, evento_id, participante_id, origem, mudancas)
        values (a.id, a.evento_id, p.id, 'retroativo', public.auto_diff(to_jsonb(p), to_jsonb(r)));
        n := n + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('alterados', n);
end $$;

create or replace function public.automacao_estatisticas(p_evento uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.evento_visivel(p_evento) then raise exception 'Sem acesso a este evento.'; end if;
  return coalesce((
    select jsonb_object_agg(s.automacao_id::text, jsonb_build_object('total', s.total, 'ultima', s.ultima))
      from (select automacao_id, count(*) as total, max(em) as ultima
              from public.automacao_execucoes
             where evento_id = p_evento and em > now() - interval '30 days'
             group by automacao_id) s
  ), '{}'::jsonb);
end $$;

revoke execute on function public.automacao_preview(uuid), public.automacao_aplicar_existentes(uuid),
  public.automacao_estatisticas(uuid) from public, anon;
grant execute on function public.automacao_preview(uuid), public.automacao_aplicar_existentes(uuid),
  public.automacao_estatisticas(uuid) to authenticated;
