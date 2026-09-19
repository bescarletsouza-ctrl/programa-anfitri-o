-- =============================================================================
-- 0032 — Normaliza o travessão nas faixas de faturamento já cadastradas.
-- Algumas linhas ficaram com hífen simples ("50 mil - 150 mil/mês") em vez do
-- travessão padrão ("50 mil – 150 mil/mês") usado pelo select do app — o
-- relatório "Perfil de faturamento" agrupava por texto exato e mostrava a
-- mesma faixa duas vezes. O app já normaliza isso na tela; esta migração
-- corrige o que já está salvo no banco.
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

update public.participantes
set faturamento = trim(regexp_replace(faturamento, '\s*[-–—]\s*', ' – ', 'g'))
where faturamento is not null
  and faturamento ~ '[-–—]'
  and faturamento <> trim(regexp_replace(faturamento, '\s*[-–—]\s*', ' – ', 'g'));
