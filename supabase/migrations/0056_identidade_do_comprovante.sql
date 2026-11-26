-- =============================================================================
-- 0056 — Identidade visual e textos do comprovante de inscrição (um por evento).
--
-- Guarda logo, imagem do topo, cores, fonte e textos do e-mail de comprovante, pra todos que usam o evento
-- verem o mesmo modelo. Fica numa tabela separada (e não em "eventos") porque as imagens pesam: assim nenhuma
-- outra tela nem o app de check-in carregam isso à toa.
-- Só cria a tabela nova: não altera nem apaga dados. Pré-requisito: 0051. Pode rodar mais de uma vez.
-- Rode no SQL Editor.
-- =============================================================================

create table if not exists public.evento_comprovante (
  evento_id      uuid primary key references public.eventos(id) on delete cascade,
  config         jsonb not null default '{}'::jsonb,
  atualizado_em  timestamptz not null default now()
);

alter table public.evento_comprovante enable row level security;
drop policy if exists "escopo da org" on public.evento_comprovante;
create policy "escopo da org" on public.evento_comprovante for all to authenticated
  using (public.evento_visivel(evento_id))
  with check (public.evento_visivel(evento_id));
revoke all on public.evento_comprovante from anon;
grant select, insert, update, delete on public.evento_comprovante to authenticated;
