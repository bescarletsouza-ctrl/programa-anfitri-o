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
  "atividades",
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

export const criarEvento = (nome, data, local) =>
  supabase.rpc("criar_evento", { p_nome: nome, p_data: data || null, p_local: local || null }).then(ok);

/* ---- Leitura (admin: escopo automático) ------------------------------ */
export const listGrupos = (eid) =>
  supabase.from("grupos").select("*").eq("evento_id", ev(eid)).order("nome").then(ok);

export const listResponsaveis = (eid) =>
  supabase.from("responsaveis").select("*").eq("evento_id", ev(eid)).order("nome").then(ok);

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
    .select("*, anfitriao:anfitrioes(id, nome, slug, grupo_id, categoria_convidado)")
    .eq("evento_id", ev(eid))
    .order("created_at", { ascending: false })
    .then(ok);

// Mantém a lista de Participantes em dia com a decisão do convidado:
// aprovado → cria o participante (categoria = a do anfitrião); reprovado/pendente
// → remove o participante gerado (sempre, mesmo com check-in).
export async function sincParticipanteConvidado(convidado) {
  const aprovado = ["Aprovado", "Confirmado"].includes(convidado.status);
  const existentes = await supabase
    .from("participantes").select("id").eq("convidado_id", convidado.id).then(ok);
  if (aprovado && !existentes.length) {
    return salvar("participantes", {
      nome: convidado.nome,
      email: convidado.email || null,
      telefone: convidado.telefone || null,
      empresa: convidado.empresa || null,
      tipo: "Convidado",
      pagamento: "Convidado",
      ingresso: convidado.anfitriao?.categoria_convidado || null,
      convidado_id: convidado.id,
    });
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
      if (vinc.tipo !== "Anfitrião") await salvar("participantes", { id: vinc.id, tipo: "Anfitrião" });
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
      await salvar("participantes", { id: alvo.id, tipo: "Anfitrião", anfitriao_id: a.id });
      await salvar("anfitrioes", { id: a.id, participante_id: alvo.id });
      return alvo.id;
    }
    const novo = await salvar("participantes", {
      evento_id: a.evento_id,
      nome: a.nome, email: a.email || null, telefone: a.telefone || null,
      tipo: "Anfitrião", pagamento: "Gratuito", anfitriao_id: a.id, origem_anfitriao: true,
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
  if (atividadeId) return { id: participanteId };
  return salvar("participantes", {
    id: participanteId,
    presente: acao === "entrada",
    checkin_at: acao === "entrada" ? new Date().toISOString() : null,
  });
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
    .order("confirmados", { ascending: false })
    .then(ok);

export const criarConvidado = (registro) =>
  supabase.from("convidados").insert(registro).select().single().then(ok);

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

export async function removerEmLote(tabela, ids) {
  if (!ids?.length) return [];
  return ok(await supabase.from(tabela).delete().in("id", ids).select());
}

export async function inserirLote(tabela, registros) {
  const rs = registros.map((r) => comEvento(tabela, r));
  return ok(await supabase.from(tabela).insert(rs).select());
}
