-- =============================================================================
-- Programa Anfitrião — Fase 2.1: mensagens por status para o acompanhamento
-- Rode no SQL Editor do mesmo projeto Supabase.
-- =============================================================================

alter table public.config
  add column if not exists texto_aprovado text
    default 'Boa notícia! Sua aplicação foi aprovada. Em breve entramos em contato com os próximos passos.',
  add column if not exists texto_recusado text
    default 'Obrigado pelo seu interesse. Desta vez sua aplicação não foi aprovada.',
  add column if not exists texto_em_analise text
    default 'Sua aplicação está em análise. Avisaremos assim que houver uma resposta.';
