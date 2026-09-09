// =============================================================================
// Cliente Supabase + helpers de query.
// supabase-js carregado via CDN (esm.sh), sem build step — igual ao restante do
// repositório.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const CONFIGURADO =
  /^https?:\/\/.+/.test(SUPABASE_URL) && !SUPABASE_URL.startsWith("COLE_AQUI");

if (!CONFIGURADO) {
  console.warn(
    "[Programa Anfitrião] Configure SUPABASE_URL e SUPABASE_ANON_KEY em assets/js/config.js"
  );
}

// Quando não configurado, usa uma URL válida de fachada só para o createClient
// não estourar — as queries falham e as telas mostram o aviso de configuração.
export const supabase = createClient(
  CONFIGURADO ? SUPABASE_URL : "https://placeholder.supabase.co",
  CONFIGURADO ? SUPABASE_ANON_KEY : "placeholder-anon-key"
);

// Lança o erro do supabase de forma legível (pego pelas telas para virar toast).
function ok(res) {
  if (res.error) {
    console.error(res.error);
    throw new Error(res.error.message || "Erro na consulta ao banco.");
  }
  return res.data;
}

/* ---- Leitura ------------------------------------------------------------- */
export const listGrupos = () =>
  supabase.from("grupos").select("*").order("nome").then(ok);

export const listResponsaveis = () =>
  supabase.from("responsaveis").select("*").order("nome").then(ok);

export const listEstagios = () =>
  supabase.from("estagios").select("*").order("ordem").then(ok);

export const listAnfitrioes = () =>
  supabase
    .from("anfitrioes_com_stats")
    .select("*")
    .order("nome")
    .then(ok);

export const listConvidados = () =>
  supabase
    .from("convidados")
    .select("*, anfitriao:anfitrioes(id, nome, slug, grupo_id)")
    .order("created_at", { ascending: false })
    .then(ok);

export const listConvidadosDoAnfitriao = (anfitriaoId) =>
  supabase
    .from("convidados")
    .select("*")
    .eq("anfitriao_id", anfitriaoId)
    .order("created_at", { ascending: false })
    .then(ok);

export const listFormPerguntas = () =>
  supabase.from("form_perguntas").select("*").order("ordem").then(ok);

export const listMarcos = () =>
  supabase.from("marcos").select("*").order("quantidade").then(ok);

export const listEtapasParticipante = () =>
  supabase.from("etapas_participante").select("*").order("ordem").then(ok);

export const listParticipantes = () =>
  supabase
    .from("participantes")
    .select("*")
    .order("created_at", { ascending: false })
    .then(ok);

export const getConfig = () =>
  supabase.from("config").select("*").eq("id", 1).single().then(ok);

/* ---- Páginas públicas (convite / painel) ------------------------------- */
export const getAnfitriaoPorSlug = (slug) =>
  supabase
    .from("anfitrioes")
    .select("id, nome, slug, grupo_id, vai")
    .eq("slug", slug)
    .maybeSingle()
    .then(ok);

export const listRankingPublico = () =>
  supabase
    .from("ranking_publico")
    .select("*")
    .order("confirmados", { ascending: false })
    .then(ok);

export const criarConvidado = (registro) =>
  supabase.from("convidados").insert(registro).select().single().then(ok);

export const getConvidadoStatus = (id) =>
  supabase
    .from("convidados")
    .select("id, nome, status, created_at, anfitriao:anfitrioes(nome)")
    .eq("id", id)
    .maybeSingle()
    .then(ok);

export const listConvidadosPorEmail = (email) =>
  supabase
    .from("convidados")
    .select("id, nome, status, created_at, anfitriao:anfitrioes(nome)")
    .ilike("email", email.trim())
    .order("created_at", { ascending: false })
    .then(ok);

/* ---- Escrita ----------------------------------------------------------- */
// tabela: string; registro: objeto (com id => update, sem id => insert)
export async function salvar(tabela, registro) {
  const q = registro.id
    ? supabase.from(tabela).update(registro).eq("id", registro.id).select().single()
    : supabase.from(tabela).insert(registro).select().single();
  return ok(await q);
}

export async function remover(tabela, id) {
  return ok(await supabase.from(tabela).delete().eq("id", id).select());
}

// Insere vários registros de uma vez (usado na importação de lista).
export async function inserirLote(tabela, registros) {
  return ok(await supabase.from(tabela).insert(registros).select());
}

export async function salvarConfig(patch) {
  return ok(
    await supabase
      .from("config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select()
      .single()
  );
}
