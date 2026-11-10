-- =============================================================================
-- 0042 — Valor realmente pago pelo participante (R$).
--
-- Até aqui o sistema só sabia o preço de TABELA do ingresso (tipos_ingresso.preco).
-- Agora cada participante guarda o valor que ele pagou de fato — preenchido pelo
-- webhook de entrada (ex.: Guru) ou à mão no cadastro. A API de leitura passa a
-- devolver esse valor em "valor_pago" (e, se ele não existir, cai no preço de
-- tabela como antes). Idempotente.
-- =============================================================================
alter table public.participantes
  add column if not exists valor_pago numeric(12, 2)
  check (valor_pago is null or valor_pago >= 0);

-- A API devolve também o valor real. Mudar as colunas de retorno de uma função
-- exige recriá-la (o corpo é o mesmo da 0036 + a coluna valor_pago_real).
drop function if exists public.api_participantes(uuid, uuid, timestamptz, timestamptz, uuid, int);

create function public.api_participantes(
  p_org uuid, p_evento uuid, p_desde timestamptz,
  p_after_ts timestamptz, p_after_id uuid, p_limit int
)
returns table(
  id uuid, evento_id uuid, evento_nome text, tipo text,
  nome text, email text, telefone text,
  ingresso text, preco_ingresso text, quantidade int,
  valor_pago_real numeric,
  pagamento text, situacao text, convidado_status text,
  presente boolean, checkin_at timestamptz,
  utm_source text, utm_medium text, utm_campaign text,
  criado_em timestamptz, atualizado_em timestamptz
)
language sql
stable
set search_path = public
as $$
  select x.id, x.evento_id, x.evento_nome, x.tipo,
         x.nome, x.email, x.telefone,
         x.ingresso, x.preco_ingresso, x.quantidade,
         x.valor_pago_real,
         x.pagamento, x.situacao, x.convidado_status,
         x.presente, x.checkin_at,
         x.utm_source, x.utm_medium, x.utm_campaign,
         x.criado_em, x.atualizado_em
  from (
    select p.id, p.evento_id, e.nome as evento_nome, p.tipo,
           p.nome, p.email, p.telefone,
           p.ingresso, ti.preco as preco_ingresso, p.quantidade,
           p.valor_pago as valor_pago_real,
           p.pagamento, p.situacao, c.status as convidado_status,
           coalesce(p.presente, false) as presente, p.checkin_at,
           c.utm_source, c.utm_medium, c.utm_campaign,
           p.created_at as criado_em,
           greatest(p.updated_at, c.updated_at) as atualizado_em
    from public.participantes p
    join public.eventos e on e.id = p.evento_id
    left join public.convidados c on c.id = p.convidado_id
    left join lateral (
      select t.preco
        from public.tipos_ingresso t
       where t.evento_id = p.evento_id
         and lower(btrim(t.nome)) = lower(btrim(p.ingresso))
       limit 1
    ) ti on true
    where (p_org is null or e.org_id = p_org)
      and (p_evento is null or p.evento_id = p_evento)
  ) x
  where (p_desde is null or x.atualizado_em >= p_desde)
    and (p_after_ts is null or (x.atualizado_em, x.id) > (p_after_ts, p_after_id))
  order by x.atualizado_em, x.id
  limit p_limit;
$$;

revoke execute on function public.api_participantes(uuid, uuid, timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
grant  execute on function public.api_participantes(uuid, uuid, timestamptz, timestamptz, uuid, int) to service_role;
