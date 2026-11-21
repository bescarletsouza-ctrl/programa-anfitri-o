-- =============================================================================
-- 0049 — "Bloquear acesso" do participante (app de check-in).
--
-- No app, ao abrir um participante há a ação "Bloquear acesso": a pessoa fica marcada como bloqueada e
-- o app não deixa fazer check-in nem passar nos pontos de controle / atividades até alguém "Liberar
-- acesso". Não muda a Situação do participante (Confirmado, Pré-inscrito…), é um marcador à parte.
-- Idempotente. Rode no SQL Editor.
-- =============================================================================

alter table public.participantes
  add column if not exists acesso_bloqueado boolean not null default false,
  add column if not exists acesso_bloqueado_em timestamptz;
