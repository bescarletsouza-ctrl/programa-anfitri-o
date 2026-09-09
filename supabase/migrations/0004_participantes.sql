-- =============================================================================
-- Programa Anfitrião — Fase 2.2: lista de participantes + pipeline do evento
-- Rode no SQL Editor do mesmo projeto Supabase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Etapas do pipeline de participantes (colunas do kanban). Editável no admin.
-- -----------------------------------------------------------------------------
create table if not exists public.etapas_participante (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int  not null default 0,
  cor        text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Participantes do evento (todos: anfitriões, convidados, compradores, etc.).
-- Lista 100% manual. Quando tipo = 'Anfitrião', o app também cria/vincula um
-- registro em public.anfitrioes (anfitriao_id) para não duplicar.
-- -----------------------------------------------------------------------------
create table if not exists public.participantes (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  email        text,
  telefone     text,
  tipo         text not null default 'Convidado',   -- Convidado|Anfitrião|Acompanhante|Comprador|Outro
  ingresso     text,
  faturamento  text,
  pagamento    text not null default 'Gratuito',    -- Gratuito|Pago|Convidado|Cancelado|Reembolsado
  quantidade   int  not null default 1,
  etapa_id     uuid references public.etapas_participante(id) on delete set null,
  anfitriao_id uuid references public.anfitrioes(id) on delete set null,
  observacao   text,
  created_at   timestamptz not null default now()
);

create index if not exists participantes_etapa_idx on public.participantes(etapa_id);
create index if not exists participantes_tipo_idx  on public.participantes(tipo);

-- -----------------------------------------------------------------------------
-- RLS (padrão temporário: aberto para "anon" até o login entrar)
-- -----------------------------------------------------------------------------
alter table public.etapas_participante enable row level security;
alter table public.participantes       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['etapas_participante', 'participantes']
  loop
    execute format('drop policy if exists "anon full access" on public.%I;', t);
    execute format(
      'create policy "anon full access" on public.%I
         for all to anon using (true) with check (true);', t);
  end loop;
end $$;

grant usage on schema public to anon;
grant select, insert, update, delete on
  public.etapas_participante, public.participantes to anon;

-- -----------------------------------------------------------------------------
-- Seed: etapas padrão (só se a tabela estiver vazia)
-- -----------------------------------------------------------------------------
insert into public.etapas_participante (nome, ordem, cor)
select * from (values
  ('Nova inscrição',          1, '#2563eb'),
  ('1º contato',              2, '#f59e0b'),
  ('Aguardando acompanhante', 3, '#fb923c'),
  ('Confirmação de presença', 4, '#ea580c'),
  ('Confirmado',              5, '#16a34a')
) as v(nome, ordem, cor)
where not exists (select 1 from public.etapas_participante);
