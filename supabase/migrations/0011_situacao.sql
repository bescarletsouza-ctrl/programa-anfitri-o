-- =============================================================================
-- 0011 — "Situação" da inscrição do participante (eixo separado de "pagamento").
--   Confirmado | Pendente | Fila de espera | Pré-inscrito | Desativado
--   "Desativado" = inscrição removida: some da lista por padrão, aparece só no
--   filtro "Desativados" e não conta em presença / relatórios / categorias.
-- Rode no SQL Editor do mesmo projeto Supabase. Idempotente.
-- =============================================================================

alter table public.participantes
  add column if not exists situacao text not null default 'Confirmado';

create index if not exists participantes_situacao_idx
  on public.participantes(evento_id, situacao);

-- backfill a partir do pagamento atual
update public.participantes
   set situacao = 'Desativado'
 where pagamento in ('Cancelado', 'Reembolsado') and situacao = 'Confirmado';
