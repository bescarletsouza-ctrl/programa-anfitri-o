-- =============================================================================
-- 0026 — Desfaz o efeito da 0025 (e do check-in que, por um tempo, marcava o
-- convidado como "Confirmado" sozinho). A partir de agora, "Confirmado" é
-- um status controlado manualmente em Gestão de convidados — check-in
-- (presença no evento) é outra coisa e não mexe mais nele.
--
-- ATENÇÃO — isso é uma heurística, não uma reversão exata: o UPDATE abaixo
-- só reverte quem está "Confirmado" E tem checkin_at preenchido no
-- participante ligado (ou seja, foi credenciado). Se você confirmou alguém
-- manualmente em Gestão de Convidados e essa mesma pessoa TAMBÉM foi
-- credenciada, ela vai reverter para "Aprovado" também — não tem como
-- distinguir os dois casos depois do fato.
--
-- Rode primeiro o SELECT pra conferir quem seria afetado; só rode o UPDATE
-- se a lista fizer sentido.
-- =============================================================================

-- 1) Conferir antes de mudar qualquer coisa:
select c.id, c.nome, c.status, p.checkin_at
from public.convidados c
join public.participantes p on p.convidado_id = c.id
where c.status = 'Confirmado' and p.checkin_at is not null;

-- 2) Se a lista acima bater com o que você espera reverter, rode:
-- update public.convidados c
-- set status = 'Aprovado'
-- from public.participantes p
-- where p.convidado_id = c.id
--   and c.status = 'Confirmado'
--   and p.checkin_at is not null;
