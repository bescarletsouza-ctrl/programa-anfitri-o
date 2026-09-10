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
