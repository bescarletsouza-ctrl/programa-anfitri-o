-- =============================================================================
-- 0050 — Senha para "Adicionar participantes" no app de check-in.
--
-- No app, em Configurações, "Adicionar participantes" vem TRAVADO: só quem souber a senha do evento
-- libera naquele aparelho (aparece o botão + na lista de participantes). O admin define a senha na
-- plataforma (Configurações ▸ Check-in). Aqui fica só o HASH (SHA-256 de "<id do evento>:<senha>"),
-- nunca a senha. É uma trava de uso do dia a dia, não um cofre: quem tem acesso ao evento consegue ler o
-- hash. Agentes não conseguem alterá-lo (o gatilho de eventos já limita o que eles mudam).
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

alter table public.eventos
  add column if not exists senha_adicionar_hash text;
