-- =============================================================================
-- 0044 — Observações como REGISTROS (histórico), em vez de um campo de texto único.
--
-- Cada observação guarda quem escreveu, data e hora, e pode ser editada ou
-- excluída. Vale para participantes, anfitriões e convidados (registro_tipo).
--
--  * autor e data são preenchidos PELO BANCO (trigger) — o navegador não consegue
--    forjar o nome de outra pessoa;
--  * editar/excluir: só quem escreveu, admin da organização ou admin da
--    plataforma (a RLS garante, não só a tela). Editar grava "editado por … em …";
--  * as observações antigas (coluna `observacao` dos três cadastros) viram a
--    primeira observação de cada registro, sem autor ("Observação anterior");
--  * transferir participante de evento leva as observações junto; apagar o
--    registro apaga as observações dele.
-- Idempotente.
-- =============================================================================
create table if not exists public.observacoes (
  id               uuid primary key default gen_random_uuid(),
  evento_id        uuid not null references public.eventos(id) on delete cascade,
  registro_tipo    text not null check (registro_tipo in ('participante', 'anfitriao', 'convidado')),
  registro_id      uuid not null,
  texto            text not null check (length(btrim(texto)) > 0),
  autor_id         uuid,
  autor_nome       text,
  created_at       timestamptz not null default now(),
  editado_em       timestamptz,
  editado_por_nome text
);
create index if not exists observacoes_registro_idx
  on public.observacoes(registro_tipo, registro_id, created_at desc);
create index if not exists observacoes_evento_idx on public.observacoes(evento_id);

-- nome de quem está logado (equipe → e-mail da equipe → admin da plataforma → e-mail do login)
create or replace function public.obs_nome_usuario()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(m.nome), '')  from public.org_membros m where m.user_id = auth.uid() and nullif(btrim(m.nome), '')  is not null limit 1),
    (select nullif(btrim(m.email), '') from public.org_membros m where m.user_id = auth.uid() and nullif(btrim(m.email), '') is not null limit 1),
    (select nullif(btrim(a.email), '') from public.plataforma_admins a where a.user_id = auth.uid()),
    nullif(btrim(auth.jwt() ->> 'email'), ''),
    'Usuário'
  );
$$;

-- quem pode editar/excluir uma observação
create or replace function public.obs_pode_gerir(p_evento uuid, p_autor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_plataforma_admin()
      or (p_autor is not null and p_autor = auth.uid())
      or exists (
        select 1 from public.eventos e
         where e.id = p_evento and e.org_id in (select public.orgs_que_administro())
      );
$$;

alter table public.observacoes enable row level security;

drop policy if exists "observacoes ver"      on public.observacoes;
drop policy if exists "observacoes criar"    on public.observacoes;
drop policy if exists "observacoes editar"   on public.observacoes;
drop policy if exists "observacoes excluir"  on public.observacoes;
create policy "observacoes ver"     on public.observacoes for select to authenticated
  using (public.evento_visivel(evento_id));
create policy "observacoes criar"   on public.observacoes for insert to authenticated
  with check (public.evento_visivel(evento_id));
create policy "observacoes editar"  on public.observacoes for update to authenticated
  using (public.evento_visivel(evento_id) and public.obs_pode_gerir(evento_id, autor_id))
  with check (public.evento_visivel(evento_id));
create policy "observacoes excluir" on public.observacoes for delete to authenticated
  using (public.evento_visivel(evento_id) and public.obs_pode_gerir(evento_id, autor_id));

revoke all on public.observacoes from anon;
grant select, insert, update, delete on public.observacoes to authenticated;
revoke execute on function public.obs_nome_usuario(), public.obs_pode_gerir(uuid, uuid) from public, anon;
grant  execute on function public.obs_nome_usuario(), public.obs_pode_gerir(uuid, uuid) to authenticated;

-- autor/data por conta do banco; o registro tem que ser do mesmo evento
create or replace function public.observacoes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_evento uuid;
begin
  if tg_op = 'INSERT' then
    execute format('select evento_id from public.%I where id = $1',
      case new.registro_tipo when 'participante' then 'participantes'
                             when 'anfitriao'    then 'anfitrioes'
                             else 'convidados' end)
      into v_evento using new.registro_id;
    if v_evento is null or v_evento is distinct from new.evento_id then
      raise exception 'Observação: o registro não pertence a este evento.';
    end if;
    if auth.uid() is not null then            -- vindo da tela: o banco decide autor e hora
      new.autor_id   := auth.uid();
      new.autor_nome := public.obs_nome_usuario();
      new.created_at := now();
      new.editado_em := null;
      new.editado_por_nome := null;
    end if;
    new.texto := btrim(new.texto);
  else  -- UPDATE: só o texto muda; o resto é preservado
    -- (exceção: o gatilho de transferência de participante acompanha o novo evento)
    if coalesce(current_setting('app.obs_acompanha_evento', true), '') <> 'on' then
      new.evento_id   := old.evento_id;
    end if;
    new.registro_tipo := old.registro_tipo;
    new.registro_id   := old.registro_id;
    new.autor_id      := old.autor_id;
    new.autor_nome    := old.autor_nome;
    new.created_at    := old.created_at;
    new.texto         := btrim(new.texto);
    if new.texto is distinct from old.texto then
      new.editado_em       := now();
      new.editado_por_nome := coalesce(public.obs_nome_usuario(), 'Usuário');
    else
      new.editado_em       := old.editado_em;
      new.editado_por_nome := old.editado_por_nome;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_observacoes_antes on public.observacoes;
create trigger trg_observacoes_antes before insert or update on public.observacoes
  for each row execute function public.observacoes_antes();

-- participante transferido de evento → as observações vão junto
create or replace function public.observacoes_segue_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.evento_id is distinct from old.evento_id then
    perform set_config('app.obs_acompanha_evento', 'on', true);   -- só nesta transação
    update public.observacoes set evento_id = new.evento_id
     where registro_tipo = 'participante' and registro_id = new.id;
    perform set_config('app.obs_acompanha_evento', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists trg_observacoes_segue_evento on public.participantes;
create trigger trg_observacoes_segue_evento after update of evento_id on public.participantes
  for each row execute function public.observacoes_segue_evento();

-- registro excluído → observações dele também
create or replace function public.observacoes_apaga_junto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.observacoes where registro_tipo = tg_argv[0] and registro_id = old.id;
  return null;
end $$;
drop trigger if exists trg_obs_apaga_participante on public.participantes;
create trigger trg_obs_apaga_participante after delete on public.participantes
  for each row execute function public.observacoes_apaga_junto('participante');
drop trigger if exists trg_obs_apaga_anfitriao on public.anfitrioes;
create trigger trg_obs_apaga_anfitriao after delete on public.anfitrioes
  for each row execute function public.observacoes_apaga_junto('anfitriao');
drop trigger if exists trg_obs_apaga_convidado on public.convidados;
create trigger trg_obs_apaga_convidado after delete on public.convidados
  for each row execute function public.observacoes_apaga_junto('convidado');

-- -----------------------------------------------------------------------------
-- Observações antigas (campo de texto) → 1ª observação do registro, sem autor.
-- Só cria se o registro ainda não tem nenhuma (pode rodar de novo sem duplicar).
-- -----------------------------------------------------------------------------
insert into public.observacoes (evento_id, registro_tipo, registro_id, texto, autor_nome, created_at)
select p.evento_id, 'participante', p.id, btrim(p.observacao), 'Observação anterior', coalesce(p.updated_at, p.created_at, now())
  from public.participantes p
 where nullif(btrim(p.observacao), '') is not null
   and not exists (select 1 from public.observacoes o where o.registro_tipo = 'participante' and o.registro_id = p.id);

insert into public.observacoes (evento_id, registro_tipo, registro_id, texto, autor_nome, created_at)
select a.evento_id, 'anfitriao', a.id, btrim(a.observacao), 'Observação anterior', coalesce(a.created_at, now())
  from public.anfitrioes a
 where nullif(btrim(a.observacao), '') is not null
   and not exists (select 1 from public.observacoes o where o.registro_tipo = 'anfitriao' and o.registro_id = a.id);

insert into public.observacoes (evento_id, registro_tipo, registro_id, texto, autor_nome, created_at)
select c.evento_id, 'convidado', c.id, btrim(c.observacao), 'Observação anterior', coalesce(c.updated_at, c.created_at, now())
  from public.convidados c
 where nullif(btrim(c.observacao), '') is not null
   and not exists (select 1 from public.observacoes o where o.registro_tipo = 'convidado' and o.registro_id = c.id);
