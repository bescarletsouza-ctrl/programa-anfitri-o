-- =============================================================================
-- 0051 — Deixa a plataforma rápida de novo (consultas lentas por causa do acesso por evento).
--
-- Causa: toda linha de participantes/checkins/acessos etc. passa pela regra "esse evento é visível pra
-- você?" (evento_visivel). Depois da 0046 essa regra ficou mais pesada (várias consultas por linha) e, com
-- milhares de linhas, a tela passou a levar segundos pra abrir.
--
-- Correção: a regra continua EXATAMENTE a mesma (acesso_evento), mas o resultado "pode ver" de cada evento
-- fica guardado só durante aquela consulta — então é calculado 1 vez por evento, e não 1 vez por linha.
-- Nada é guardado entre consultas e só o "sim" é lembrado (o "não" é sempre recalculado).
-- Nenhuma permissão muda. Idempotente. Rode no SQL Editor.
-- =============================================================================

create or replace function public.evento_visivel(p_evento uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  k text;
  r boolean;
begin
  if p_evento is null then
    return public.acesso_evento(null, null);
  end if;
  k := 'we.ev_' || md5(coalesce(auth.uid()::text, '-') || p_evento::text);
  if current_setting(k, true) = 't' then
    return true;
  end if;
  r := public.acesso_evento(p_evento, null);
  if r then
    perform set_config(k, 't', true);   -- true = vale só nesta transação/consulta
  end if;
  return r;
end;
$$;

grant execute on function public.evento_visivel(uuid) to authenticated;
