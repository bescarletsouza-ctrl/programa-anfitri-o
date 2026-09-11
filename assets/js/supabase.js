// =============================================================================
// Cliente Supabase + helpers de query. Sem build step (esm.sh).
// Tudo no admin é escopado pelo evento atual (evento.js). As páginas públicas
// passam o evento_id do anfitrião explicitamente.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { eventoId } from "./evento.js";

export const CONFIGURADO =
  /^https?:\/\/.+/.test(SUPABASE_URL) && !SUPABASE_URL.startsWith("COLE_AQUI");

if (!CONFIGURADO) {
  console.warn("[Programa Anfitrião] Configure SUPABASE_URL e SUPABASE_ANON_KEY em assets/js/config.js");
}

export const supabase = createClient(
  CONFIGURADO ? SUPABASE_URL : "https://placeholder.supabase.co",
  CONFIGURADO ? SUPABASE_ANON_KEY : "placeholder-anon-key"
);

function ok(res) {
  if (res.error) {
    console.error(res.error);
    throw new Error(res.error.message || "Erro na consulta ao banco.");
  }
  return res.data;
}

// Tabelas escopadas por evento (usado na auto-injeção de evento_id nos inserts).
const TABELAS_EVENTO = new Set([
  "grupos", "responsaveis", "estagios", "anfitrioes", "convidados",
  "form_perguntas", "marcos", "etapas_participante", "participantes", "checkins",
  "atividades", "tipos_ingresso", "integracoes", "webhook_entregas",
]);

// eid: id explícito (páginas públicas). Sem argumento → evento atual do admin.
const ev = (eid) => eid || eventoId();

/* ---- Eventos ---------------------------------------------------------- */
export const listEventos = () =>
  supabase.from("eventos").select("*").order("created_at", { ascending: false }).then(ok);

export const getEvento = (id) =>
  supabase.from("eventos").select("*").eq("id", id).maybeSingle().then(ok);

export const salvarEvento = (patch) =>
  supabase.from("eventos").update(patch).eq("id", eventoId()).select().single().then(ok);

export const criarEvento = (nome, orgId, data, local) =>
  supabase.rpc("criar_evento", {
    p_nome: nome, p_org_id: orgId, p_data: data || null, p_local: local || null,
  }).then(ok);

export const salvarEventoPorId = (id, patch) =>
  supabase.from("eventos").update(patch).eq("id", id).select().single().then(ok);

// Apaga o evento — o "on delete cascade" em evento_id leva junto anfitriões,
// convidados, participantes, check-ins, atividades, ingressos e configurações.
export const excluirEvento = (id) =>
  supabase.from("eventos").delete().eq("id", id).then(ok);

/* ---- Visão geral (todos os eventos, SEM escopo) --------------------- */
export const listParticipantesTodos = () =>
  supabase.from("participantes")
    .select("id, evento_id, situacao, presente, tipo, ingresso, pagamento, quantidade, created_at, checkin_at")
    .then(ok);

export const listCheckinsTodos = () =>
  supabase.from("checkins").select("evento_id, participante_id, acao, at, atividade_id").then(ok);

export const listAnfitrioesTodos = () =>
  supabase.from("anfitrioes_com_stats")
    .select("id, evento_id, nome, tipo, vai, enviados, aprovados, confirmados").then(ok);

export const listTiposIngressoTodos = () =>
  supabase.from("tipos_ingresso").select("evento_id, nome, preco").then(ok);

/* ---- Leitura (admin: escopo automático) ------------------------------ */
export const listGrupos = (eid) =>
  supabase.from("grupos").select("*").eq("evento_id", ev(eid)).order("nome").then(ok);

export const listEstagios = (eid) =>
  supabase.from("estagios").select("*").eq("evento_id", ev(eid)).order("ordem").then(ok);

export const listEtapasParticipante = (eid) =>
  supabase.from("etapas_participante").select("*").eq("evento_id", ev(eid)).order("ordem").then(ok);

export const listMarcos = (eid) =>
  supabase.from("marcos").select("*").eq("evento_id", ev(eid)).order("quantidade").then(ok);

export const listFormPerguntas = (eid) =>
  supabase.from("form_perguntas").select("*").eq("evento_id", ev(eid)).order("ordem").then(ok);

export const listAnfitrioes = (eid) =>
  supabase.from("anfitrioes_com_stats").select("*").eq("evento_id", ev(eid)).order("nome").then(ok);

export const listConvidados = (eid) =>
  supabase
    .from("convidados")
    .select("*, anfitriao:anfitrioes(id, nome, slug, grupo_id, categoria_convidado, responsavel_user_id)")
    .eq("evento_id", ev(eid))
    .order("created_at", { ascending: false })
    .then(ok);

// Situação inicial de quem entra por um tipo de ingresso: respeita
// situacao_padrao; se lista_espera está ligada e as vagas lotaram → "Fila de espera".
async function situacaoDoTipo(eventoId, ingresso) {
  const nome = (ingresso || "").trim();
  if (!nome || !eventoId) return "Confirmado";
  let t;
  try {
    t = await supabase.from("tipos_ingresso").select("*")
      .eq("evento_id", eventoId).ilike("nome", nome).limit(1).then((r) => (r.data || [])[0]);
  } catch { return "Confirmado"; }
  if (!t) return "Confirmado";
  if (t.lista_espera && t.vagas) {
    const usados = await supabase.from("participantes")
      .select("id", { count: "exact", head: true })
      .eq("evento_id", eventoId).ilike("ingresso", nome).neq("situacao", "Desativado")
      .then((r) => r.count || 0).catch(() => 0);
    if (usados >= t.vagas) return "Fila de espera";
  }
  return t.situacao_padrao || "Confirmado";
}

// Primeira etapa do pipeline (a de menor "ordem") — todo participante novo
// entra por ela. Retorna null se o evento ainda não tem etapas.
async function primeiraEtapaId(eventoId) {
  if (!eventoId) return null;
  try {
    const r = await supabase.from("etapas_participante").select("id")
      .eq("evento_id", eventoId).order("ordem").limit(1);
    return (r.data || [])[0]?.id || null;
  } catch { return null; }
}

// Mantém a lista de Participantes em dia com a decisão do convidado:
// aprovado → cria o participante (categoria = a do anfitrião); reprovado/pendente
// → remove o participante gerado (sempre, mesmo com check-in).
export async function sincParticipanteConvidado(convidado) {
  const aprovado = ["Aprovado", "Confirmado"].includes(convidado.status);
  const existentes = await supabase
    .from("participantes").select("id").eq("convidado_id", convidado.id).then(ok);
  if (aprovado && !existentes.length) {
    const ingresso = convidado.anfitriao?.categoria_convidado || null;
    const novo = await salvar("participantes", {
      nome: convidado.nome,
      email: convidado.email || null,
      telefone: convidado.telefone || null,
      empresa: convidado.empresa || null,
      tipo: "Convidado",
      pagamento: "Convidado",
      ingresso,
      situacao: await situacaoDoTipo(convidado.evento_id, ingresso),
      etapa_id: await primeiraEtapaId(convidado.evento_id),
      convidado_id: convidado.id,
      // herda o responsável do anfitrião que convidou (não da categoria)
      responsavel_user_id: convidado.anfitriao?.responsavel_user_id || null,
    });
    dispararIntegracoes("convidado.aprovado", { participante_id: novo.id, participante: { nome: novo.nome, email: novo.email, telefone: novo.telefone }, convidado_id: convidado.id });
    return novo;
  }
  if (!aprovado && existentes.length) {
    await supabase.from("participantes").delete().in("id", existentes.map((p) => p.id)).then(ok);
  }
}

// Categoria do anfitrião mudou → atualiza os participantes já gerados por ele.
export async function reSincCategoriaAnfitriao(anfitriaoId, categoria) {
  const convs = await supabase
    .from("convidados").select("id").eq("anfitriao_id", anfitriaoId).then(ok);
  if (!convs.length) return;
  await supabase
    .from("participantes")
    .update({ ingresso: categoria || null })
    .in("convidado_id", convs.map((c) => c.id))
    .then(ok);
}

// Responsável do anfitrião mudou → convidados dele já virados participante
// acompanham o novo responsável (eles herdam do anfitrião, não da categoria).
export async function reSincResponsavelAnfitriao(anfitriaoId, responsavelUserId) {
  const convs = await supabase
    .from("convidados").select("id").eq("anfitriao_id", anfitriaoId).then(ok);
  if (!convs.length) return;
  await supabase
    .from("participantes")
    .update({ responsavel_user_id: responsavelUserId || null })
    .in("convidado_id", convs.map((c) => c.id))
    .then(ok);
}

// -----------------------------------------------------------------------------
// Sincronismo Anfitrião <-> Participante (chave: e-mail).
//  - participante tipo "Anfitrião"  -> tem que existir na aba Anfitriões
//  - anfitrião com vai=true          -> tem que existir em Participantes
//  - 1-para-1 (anfitrioes.participante_id / participantes.anfitriao_id); quando
//    não há vínculo, casa por e-mail; nunca duplica.
//  - origem_* = criado automaticamente (só esses somem ao desfazer a condição).
// -----------------------------------------------------------------------------
const mesmoEmail = (a, b) => {
  const x = (a || "").trim().toLowerCase();
  return x && x === (b || "").trim().toLowerCase();
};

// Chamado depois de salvar um PARTICIPANTE. Retorna o anfitriao_id (ou null).
export async function sincParticipanteAnfitriao(participante) {
  const p = participante || {};
  const ehAnfitriao = p.tipo === "Anfitrião";

  let vinc = null;
  if (p.anfitriao_id) {
    vinc = await supabase.from("anfitrioes").select("*").eq("id", p.anfitriao_id).maybeSingle().then((r) => r.data);
  }

  if (ehAnfitriao) {
    if (vinc) {
      const patch = {};
      if (vinc.vai === false) patch.vai = true;
      if (vinc.participante_id !== p.id) patch.participante_id = p.id;
      if (Object.keys(patch).length) await salvar("anfitrioes", { id: vinc.id, ...patch });
      return vinc.id;
    }
    // sem vínculo → casa por e-mail
    let alvo = null;
    const email = (p.email || "").trim();
    if (email) {
      const cand = await supabase
        .from("anfitrioes").select("*")
        .eq("evento_id", p.evento_id).ilike("email", email).is("participante_id", null)
        .limit(1).then((r) => r.data || []);
      alvo = cand.find((a) => mesmoEmail(a.email, email)) || null;
    }
    if (alvo) {
      await salvar("anfitrioes", { id: alvo.id, vai: true, participante_id: p.id });
      await salvar("participantes", { id: p.id, anfitriao_id: alvo.id });
      return alvo.id;
    }
    const novo = await salvar("anfitrioes", {
      evento_id: p.evento_id,
      nome: p.nome, email: p.email || null, telefone: p.telefone || null,
      tipo: "Titular", vai: true, participante_id: p.id, origem_participante: true,
    });
    await salvar("participantes", { id: p.id, anfitriao_id: novo.id });
    return novo.id;
  }

  // não é mais Anfitrião → sai da aba Anfitriões
  if (vinc) {
    const temConvidados = await supabase
      .from("convidados").select("id").eq("anfitriao_id", vinc.id).limit(1).then((r) => (r.data || []).length);
    if (vinc.origem_participante && vinc.participante_id === p.id && !temConvidados) {
      await supabase.from("anfitrioes").delete().eq("id", vinc.id);
    } else if (vinc.participante_id === p.id) {
      // mantém o anfitrião (tem convidados ou foi criado à mão), mas desliga o
      // "vai ao evento" para ele não voltar a se replicar em Participantes
      await salvar("anfitrioes", { id: vinc.id, participante_id: null, vai: false });
    }
    await salvar("participantes", { id: p.id, anfitriao_id: null });
  }
  return null;
}

// Chamado depois de salvar um ANFITRIÃO. Retorna o participante_id (ou null).
export async function sincAnfitriaoParticipante(anfitriao) {
  const a = anfitriao || {};
  const vai = a.vai !== false;

  let vinc = null;
  if (a.participante_id) {
    vinc = await supabase.from("participantes").select("*").eq("id", a.participante_id).maybeSingle().then((r) => r.data);
    if (vinc && vinc.anfitriao_id !== a.id) vinc = null; // vínculo quebrado
  }

  // participante real marcado como "Anfitrião" manda: não dá para tirá-lo do
  // evento desligando o "vai" aqui — tem que mudar o tipo dele em Participantes.
  if (!vai && vinc && vinc.tipo === "Anfitrião" && !vinc.origem_anfitriao) {
    await salvar("anfitrioes", { id: a.id, vai: true });
    return vinc.id;
  }

  if (vai) {
    if (vinc) {
      // categoria e responsável do anfitrião mandam no participante ligado
      const patch = {};
      if (vinc.tipo !== "Anfitrião") patch.tipo = "Anfitrião";
      if ((vinc.ingresso || null) !== (a.ingresso || null)) patch.ingresso = a.ingresso || null;
      if ((vinc.responsavel_user_id || null) !== (a.responsavel_user_id || null)) patch.responsavel_user_id = a.responsavel_user_id || null;
      if (Object.keys(patch).length) await salvar("participantes", { id: vinc.id, ...patch });
      return vinc.id;
    }
    let alvo = null;
    const email = (a.email || "").trim();
    if (email) {
      const cand = await supabase
        .from("participantes").select("*")
        .eq("evento_id", a.evento_id).ilike("email", email).is("anfitriao_id", null)
        .limit(1).then((r) => r.data || []);
      alvo = cand.find((p) => mesmoEmail(p.email, email)) || null;
    }
    if (alvo) {
      await salvar("participantes", {
        id: alvo.id, tipo: "Anfitrião", anfitriao_id: a.id,
        ingresso: a.ingresso || null, responsavel_user_id: a.responsavel_user_id || null,
      });
      await salvar("anfitrioes", { id: a.id, participante_id: alvo.id });
      return alvo.id;
    }
    const novo = await salvar("participantes", {
      evento_id: a.evento_id,
      nome: a.nome, email: a.email || null, telefone: a.telefone || null,
      tipo: "Anfitrião", pagamento: "Gratuito", anfitriao_id: a.id, origem_anfitriao: true,
      ingresso: a.ingresso || null, responsavel_user_id: a.responsavel_user_id || null,
      etapa_id: await primeiraEtapaId(a.evento_id),
    });
    await salvar("anfitrioes", { id: a.id, participante_id: novo.id });
    return novo.id;
  }

  // vai = false → tira o participante que foi criado automaticamente
  if (vinc && vinc.origem_anfitriao && a.participante_id === vinc.id) {
    await supabase.from("participantes").delete().eq("id", vinc.id);
    await salvar("anfitrioes", { id: a.id, participante_id: null });
  } else if (vinc && a.participante_id === vinc.id) {
    // criado à mão: mantém o participante, só desfaz o vínculo
    await salvar("anfitrioes", { id: a.id, participante_id: null });
    await salvar("participantes", { id: vinc.id, anfitriao_id: null });
  }
  return null;
}

// Antes de excluir um ANFITRIÃO: se o participante ligado foi criado
// automaticamente a partir dele, remove também.
export async function desvincularAoExcluirAnfitriao(anfitriao) {
  const pid = anfitriao?.participante_id;
  if (!pid) return;
  const p = await supabase.from("participantes").select("id, origem_anfitriao").eq("id", pid).maybeSingle().then((r) => r.data);
  if (p?.origem_anfitriao) await supabase.from("participantes").delete().eq("id", pid);
}

// Antes de excluir um PARTICIPANTE: se o anfitrião ligado foi criado
// automaticamente a partir dele e não tem convidados, remove também.
export async function desvincularAoExcluirParticipante(participante) {
  const aid = participante?.anfitriao_id;
  if (!aid) return;
  const a = await supabase.from("anfitrioes").select("id, origem_participante").eq("id", aid).maybeSingle().then((r) => r.data);
  if (!a?.origem_participante) return;
  const temConvidados = await supabase.from("convidados").select("id").eq("anfitriao_id", aid).limit(1).then((r) => (r.data || []).length);
  if (!temConvidados) await supabase.from("anfitrioes").delete().eq("id", aid);
}

export const listConvidadosDoAnfitriao = (anfitriaoId) =>
  supabase
    .from("convidados")
    .select("*")
    .eq("anfitriao_id", anfitriaoId)
    .order("created_at", { ascending: false })
    .then(ok);

export const listParticipantes = (eid) =>
  supabase
    .from("participantes")
    .select("*")
    .eq("evento_id", ev(eid))
    .order("created_at", { ascending: false })
    .then(ok);

// Busca 1 participante pelo conteúdo do QR do crachá (código ou id) — usado no
// check-in mobile. Aceita "IMER-0042" ou um uuid; tolera lixo antes/depois.
export async function buscarParticipantePorQR(valor, eid) {
  const bruto = String(valor || "").trim();
  if (!bruto) return null;
  const eventoU = ev(eid);
  const uuid = bruto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const codigo = bruto.split(/\s+/).pop();
  let q = supabase.from("participantes").select("*").eq("evento_id", eventoU).limit(1);
  q = uuid ? q.or(`id.eq.${uuid},codigo.eq.${codigo}`) : q.eq("codigo", codigo);
  const rows = await q.then(ok);
  return rows[0] || null;
}

/* ---- Tipos de ingresso ------------------------------------------- */
export const listTiposIngresso = (eid) =>
  supabase
    .from("tipos_ingresso")
    .select("*")
    .eq("evento_id", ev(eid))
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true })
    .then(ok);

/* ---- Atividades (controle de acesso por sessão) ------------------- */
export const listAtividades = (eid) =>
  supabase
    .from("atividades")
    .select("*")
    .eq("evento_id", ev(eid))
    .order("dia", { ascending: true })
    .order("inicio", { ascending: true })
    .then(ok);

// Remove os registros de check-in de uma atividade para os participantes dados
// (usado ao "excluir participante da atividade").
export async function removerCheckinsAtividade(atividadeId, participanteIds) {
  if (!atividadeId || !participanteIds?.length) return [];
  return ok(
    await supabase
      .from("checkins")
      .delete()
      .eq("atividade_id", atividadeId)
      .in("participante_id", participanteIds)
      .select()
  );
}

/* ---- Check-in (histórico entrada/saída) ---------------------------- */
export const listCheckins = (eid) =>
  supabase
    .from("checkins")
    .select("*, participante:participantes(nome, tipo, ingresso, empresa, email, codigo)")
    .eq("evento_id", ev(eid))
    .order("at", { ascending: false })
    .then(ok);

// Grava a linha no log. Modo evento (sem atividadeId): atualiza também o estado
// atual do participante (presente / checkin_at). Modo atividade: só o log — a
// presença na atividade é derivada das entradas/saídas.
export async function registrarCheckin(participanteId, acao = "entrada", origem = "checkin", atividadeId = null) {
  const linha = { participante_id: participanteId, acao, origem };
  if (atividadeId) linha.atividade_id = atividadeId;
  await salvar("checkins", linha);
  if (acao === "entrada") {
    dispararIntegracoes(atividadeId ? "checkin.atividade" : "checkin.realizado", {
      participante_id: participanteId, atividade_id: atividadeId || null,
    });
  }
  if (atividadeId) return { id: participanteId };
  const atualizado = await salvar("participantes", {
    id: participanteId,
    presente: acao === "entrada",
    checkin_at: acao === "entrada" ? new Date().toISOString() : null,
  });
  // participante que veio de um convidado (link do anfitrião): o check-in no
  // evento confirma a inscrição dele lá (senão o convidado fica "Aprovado"
  // pra sempre e o painel do anfitrião nunca mostra confirmados/conquistas
  // que dependem de status "Confirmado")
  if (atualizado.convidado_id) {
    await salvar("convidados", {
      id: atualizado.convidado_id,
      status: acao === "entrada" ? "Confirmado" : "Aprovado",
    }).catch(() => {});
  }
  return atualizado;
}

/* ---- Páginas públicas ----------------------------------------------- */
export const getAnfitriaoPorSlug = (slug) =>
  supabase
    .from("anfitrioes")
    .select("id, nome, slug, evento_id, grupo_id, vai, grupo:grupos(nome)")
    .eq("slug", slug)
    .maybeSingle()
    .then(ok);

export const listRankingPublico = (eid) =>
  supabase
    .from("ranking_publico")
    .select("*")
    .eq("evento_id", ev(eid))
    .order("aprovados", { ascending: false })
    .then(ok);

export const criarConvidado = (registro) =>
  supabase.from("convidados").insert(registro).select().single().then(ok);

// Já existe uma inscrição com esse e-mail neste evento? Usado pelo
// formulário público (convite.js) pra barrar duplicidade antes de enviar.
export async function existeConvidadoComEmail(eventoId, email) {
  const alvo = (email || "").trim();
  if (!alvo) return false;
  const r = await supabase
    .from("convidados")
    .select("id", { count: "exact", head: true })
    .eq("evento_id", eventoId)
    .ilike("email", alvo);
  if (r.error) throw new Error(r.error.message || "Erro na consulta.");
  return (r.count || 0) > 0;
}

export const getConvidadoStatus = (id) =>
  supabase
    .from("convidados")
    .select("id, nome, status, created_at, evento_id, anfitriao:anfitrioes(nome)")
    .eq("id", id)
    .maybeSingle()
    .then(ok);

export const listConvidadosPorEmail = (email) =>
  supabase
    .from("convidados")
    .select("id, nome, status, created_at, evento_id, anfitriao:anfitrioes(nome)")
    .ilike("email", email.trim())
    .order("created_at", { ascending: false })
    .then(ok);

/* ---- Escrita ------------------------------------------------------------- */
function comEvento(tabela, registro) {
  if (!registro.id && TABELAS_EVENTO.has(tabela) && !registro.evento_id) {
    return { ...registro, evento_id: eventoId() };
  }
  return registro;
}

export async function salvar(tabela, registro) {
  const r = comEvento(tabela, registro);
  const q = r.id
    ? supabase.from(tabela).update(r).eq("id", r.id).select().single()
    : supabase.from(tabela).insert(r).select().single();
  return ok(await q);
}

export async function remover(tabela, id) {
  return ok(await supabase.from(tabela).delete().eq("id", id).select());
}

export async function atualizarEmLote(tabela, ids, patch) {
  if (!ids?.length) return [];
  return ok(await supabase.from(tabela).update(patch).in("id", ids).select());
}

// Presença alterada em lote (Lista > Marcar presente/ausente): participantes
// de origem "convidado" espelham em convidados.status, igual ao check-in
// individual (registrarCheckin).
export async function sincronizarStatusConvidados(participantesAtualizados, presente) {
  const ids = (participantesAtualizados || []).filter((p) => p.convidado_id).map((p) => p.convidado_id);
  if (!ids.length) return;
  await supabase.from("convidados").update({ status: presente ? "Confirmado" : "Aprovado" }).in("id", ids);
}

export async function removerEmLote(tabela, ids) {
  if (!ids?.length) return [];
  return ok(await supabase.from(tabela).delete().in("id", ids).select());
}

export async function inserirLote(tabela, registros) {
  const rs = registros.map((r) => comEvento(tabela, r));
  return ok(await supabase.from(tabela).insert(rs).select());
}

/* ---- E-mail (Edge Function "enviar-email" + Resend) ------------------ */
// participanteIds: ids do evento atual. A function busca os e-mails no banco,
// personaliza ({nome}/{codigo}/{email}/{evento}) e dispara pelo Resend.
export async function enviarEmail({ participanteIds, assunto, corpo, de }) {
  const { data, error } = await supabase.functions.invoke("enviar-email", {
    body: { evento_id: eventoId(), participante_ids: participanteIds, assunto, corpo, de: de || null },
  });
  if (error) {
    throw new Error(
      /Failed to (send|fetch)|not found|Function not found/i.test(error.message || "")
        ? "Função de e-mail não encontrada. Faça o deploy de supabase/functions/enviar-email e configure os secrets."
        : error.message || "Falha ao enviar."
    );
  }
  if (data?.erro) throw new Error(data.erro);
  return data; // { enviados, falhas, total }
}

/* ---- Integrações e Webhooks (Edge Functions "integracoes" / "webhook-in") -- */
export const listIntegracoes = (eid) =>
  supabase.from("integracoes").select("*").eq("evento_id", ev(eid))
    .order("tipo").order("created_at", { ascending: false }).then(ok);

export const listWebhookEntregas = (eid) =>
  supabase.from("webhook_entregas").select("*").eq("evento_id", ev(eid))
    .order("at", { ascending: false }).limit(60).then(ok);

// URL que ticketeiras / gateways chamam para criar participantes.
export const webhookEntradaUrl = (token) =>
  `${SUPABASE_URL}/functions/v1/webhook-in?evento_id=${encodeURIComponent(eventoId() || "")}&token=${encodeURIComponent(token || "")}`;

// Dispara um gatilho para todas as integrações do evento. Silencioso por
// natureza (não trava o fluxo do admin se a função não estiver no ar).
export async function dispararIntegracoes(gatilho, dados = {}) {
  try {
    await supabase.functions.invoke("integracoes", {
      body: { evento_id: eventoId(), gatilho, dados },
    });
  } catch (e) {
    console.warn("[integracoes] não disparou:", e?.message || e);
  }
}

/* ---- Equipe de check-in (Edge Function "equipe" + Supabase Auth) ---------- */
async function chamarEquipe(body) {
  const { data, error } = await supabase.functions.invoke("equipe", { body });
  if (error) {
    throw new Error(
      /Failed to (send|fetch)|not found|Function not found/i.test(error.message || "")
        ? "Função não encontrada. Faça o deploy de supabase/functions/equipe."
        : error.message || "Falha na operação."
    );
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
export const listarEquipe = (orgId) => chamarEquipe({ acao: "listar", org_id: orgId }).then((d) => d.membros || []);
export const criarMembroEquipe = (orgId, dados) => chamarEquipe({ acao: "criar", org_id: orgId, ...dados });
export const trocarSenhaMembro = (orgId, membroId, senha) => chamarEquipe({ acao: "senha", org_id: orgId, membro_id: membroId, senha });
export const removerMembroEquipe = (orgId, membroId) => chamarEquipe({ acao: "remover", org_id: orgId, membro_id: membroId });

/* ---- Plataforma (Edge Function "plataforma") — só a super-admin --------- */
async function chamarPlataforma(body) {
  const { data, error } = await supabase.functions.invoke("plataforma", { body });
  if (error) {
    throw new Error(
      /Failed to (send|fetch)|not found|Function not found/i.test(error.message || "")
        ? "Função não encontrada. Faça o deploy de supabase/functions/plataforma."
        : error.message || "Falha na operação."
    );
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
export const plataformaStatus = () => chamarPlataforma({ acao: "status" });
export const bootstrapPlataforma = (email, senha) => chamarPlataforma({ acao: "bootstrap", email, senha });
export const listarOrgs = () => chamarPlataforma({ acao: "listar_orgs" }).then((d) => d.orgs || []);
export const usoEventos = () => chamarPlataforma({ acao: "uso_eventos" }).then((d) => d.eventos || []);
export const criarOrg = (dados) => chamarPlataforma({ acao: "criar_org", ...dados });
export const editarOrg = (id, patch) => chamarPlataforma({ acao: "editar_org", id, ...patch });
export const removerOrg = (id) => chamarPlataforma({ acao: "remover_org", id });
export const reenviarConvite = (orgId) => chamarPlataforma({ acao: "reenviar_convite", org_id: orgId });
export const addMembroOrg = (orgId, dados) => chamarPlataforma({ acao: "add_membro", org_id: orgId, ...dados });
export const removerMembroOrg = (membroId) => chamarPlataforma({ acao: "remover_membro", id: membroId });

// Envia um payload de teste de uma integração específica. Aqui os erros sobem.
export async function testarIntegracao(integracaoId) {
  const { data, error } = await supabase.functions.invoke("integracoes", {
    body: { evento_id: eventoId(), integracao_id: integracaoId, teste: true },
  });
  if (error) {
    throw new Error(
      /Failed to (send|fetch)|not found|Function not found/i.test(error.message || "")
        ? "Função não encontrada. Faça o deploy de supabase/functions/integracoes."
        : error.message || "Falha ao testar."
    );
  }
  if (data?.erro) throw new Error(data.erro);
  return data; // { disparadas, entregas: [{ ok, status, erro }] }
}
