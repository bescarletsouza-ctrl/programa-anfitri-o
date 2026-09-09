-- =============================================================================
-- Programa Anfitrião — Fase: Check-in / Credenciamento
-- Presença + hora de check-in + código curto único por evento (para o QR do
-- crachá e conferência manual). Rode no SQL Editor do mesmo projeto Supabase.
-- Idempotente: pode rodar de novo sem quebrar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas novas em participantes
-- -----------------------------------------------------------------------------
alter table public.participantes
  add column if not exists empresa    text,
  add column if not exists presente   boolean not null default false,
  add column if not exists checkin_at timestamptz,
  add column if not exists codigo     text;

create index if not exists participantes_presenca_idx
  on public.participantes(evento_id, presente);

-- -----------------------------------------------------------------------------
-- 2. Contador serial por evento (numeração atômica do código, inclusive quando
--    a importação de lote insere várias linhas num único INSERT)
-- -----------------------------------------------------------------------------
alter table public.eventos
  add column if not exists proximo_codigo int not null default 1;

-- -----------------------------------------------------------------------------
-- 3. Prefixo do código a partir do nome do evento (ex.: "Imersão XPTO" -> "IMER")
-- -----------------------------------------------------------------------------
create or replace function public.prefixo_evento(p_nome text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(upper(substr(regexp_replace(coalesce(p_nome, ''), '[^a-zA-Z0-9]', '', 'g'), 1, 4)), ''),
    'EV'
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Trigger: gera o código no INSERT quando não veio preenchido
-- -----------------------------------------------------------------------------
create or replace function public.participantes_set_codigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref text;
  v_n    int;
begin
  if new.codigo is not null and btrim(new.codigo) <> '' then
    return new;
  end if;

  update public.eventos
     set proximo_codigo = proximo_codigo + 1
   where id = new.evento_id
  returning proximo_codigo - 1, prefixo_evento(nome) into v_n, v_pref;

  if v_n is null then
    -- evento sem linha em eventos (não deveria acontecer): fallback seguro
    v_pref := 'EV';
    v_n := floor(extract(epoch from clock_timestamp()))::int;
  end if;

  new.codigo := v_pref || '-' || lpad(v_n::text, 4, '0');
  return new;
end $$;

drop trigger if exists trg_participantes_codigo on public.participantes;
create trigger trg_participantes_codigo
  before insert on public.participantes
  for each row execute function public.participantes_set_codigo();

-- -----------------------------------------------------------------------------
-- 5. Backfill dos participantes já existentes
-- -----------------------------------------------------------------------------
do $$
declare
  ev  record;
  reg record;
  i   int;
begin
  for ev in select id, nome from public.eventos loop
    i := 0;
    for reg in
      select id from public.participantes
      where evento_id = ev.id and (codigo is null or btrim(codigo) = '')
      order by created_at, id
    loop
      i := i + 1;
      update public.participantes
         set codigo = prefixo_evento(ev.nome) || '-' || lpad(i::text, 4, '0')
       where id = reg.id;
    end loop;
    update public.eventos
       set proximo_codigo = greatest(proximo_codigo, i + 1)
     where id = ev.id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Unicidade do código dentro do evento
-- -----------------------------------------------------------------------------
create unique index if not exists participantes_evento_codigo_uidx
  on public.participantes(evento_id, codigo);
