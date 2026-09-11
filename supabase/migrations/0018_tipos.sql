-- =============================================================================
-- 0018 — "Grupos" vira "Tipo": mesma tabela (grupos), agora com responsável
-- (um usuário da plataforma) e usada tanto em anfitriões (grupo_id, já
-- existia) quanto em participantes (o campo "Tipo" passa a ser preenchido a
-- partir desta lista, em vez de um enum fixo no código).
-- Rode no SQL Editor do Supabase. Idempotente.
-- =============================================================================

alter table public.grupos add column if not exists responsavel_user_id uuid
  references auth.users(id) on delete set null;
create index if not exists grupos_responsavel_idx on public.grupos(responsavel_user_id);

-- Semeia, em cada evento, os tipos padrão que participantes já usava
-- (com "Membro" no lugar de "Cliente") — só os que ainda não existirem lá
-- (comparação sem acento/maiúsculas), pra não duplicar tipos que o cliente
-- já tenha criado com nome parecido.
do $$
declare
  v_evento uuid;
  v_nome   text;
  v_padroes text[] := array['Convidado', 'Anfitrião', 'Acompanhante', 'Comprador', 'Membro', 'Outro'];
begin
  for v_evento in select id from public.eventos loop
    foreach v_nome in array v_padroes loop
      if not exists (
        select 1 from public.grupos g
        where g.evento_id = v_evento and lower(g.nome) = lower(v_nome)
      ) then
        insert into public.grupos (evento_id, nome) values (v_evento, v_nome);
      end if;
    end loop;
  end loop;
end $$;

-- Dados existentes: quem estava marcado "Cliente" em participantes.tipo
-- passa a "Membro" (o campo continua texto livre; só troca o rótulo/valor).
update public.participantes set tipo = 'Membro' where tipo = 'Cliente';
