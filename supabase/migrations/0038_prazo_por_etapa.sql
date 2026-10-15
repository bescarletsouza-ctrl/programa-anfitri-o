-- =============================================================================
-- 0038 — Prazo (SLA) por etapa do pipeline.
--   sla_horas          : quanto tempo o card pode ficar na etapa; passou → amarelo
--   sla_critico_horas  : passou disso → vermelho (vazio = o dobro do prazo)
-- Vale pras etapas de Participantes (etapas_participante) e pros estágios de
-- Anfitriões (estagios). Cada evento tem as suas etapas, então o prazo é
-- configurado por etapa de cada evento. Vazio = a etapa não tem prazo.
-- Idempotente.
-- =============================================================================
alter table public.etapas_participante
  add column if not exists sla_horas         numeric check (sla_horas is null or sla_horas > 0),
  add column if not exists sla_critico_horas numeric check (sla_critico_horas is null or sla_critico_horas > 0);

alter table public.estagios
  add column if not exists sla_horas         numeric check (sla_horas is null or sla_horas > 0),
  add column if not exists sla_critico_horas numeric check (sla_critico_horas is null or sla_critico_horas > 0);
