// =============================================================================
// Autenticação e contexto de organização do admin.
//  - exigirLogin(): garante uma sessão Supabase Auth (senão manda pro /login).
//  - contexto():    resolve super-admin / organização / papel / nível de acesso.
//  - guardAcesso(): bloqueia telas fora do nível de acesso da organização.
// O gate síncrono (sem flash) fica num <script> no <head> de cada admin/*.html.
// =============================================================================
import { supabase } from "./supabase.js";

let _ctx;

export async function sessao() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

function irParaLogin() {
  try { sessionStorage.setItem("we_next", location.pathname + location.search); } catch {}
  location.replace("/login.html");
}

export async function exigirLogin() {
  const s = await sessao();
  if (!s) { irParaLogin(); return null; }
  return s;
}

export async function contexto() {
  if (_ctx !== undefined) return _ctx;
  const s = await sessao();
  if (!s) return (_ctx = null);
  try {
    const [{ data: adm }, { data: membros }] = await Promise.all([
      supabase.from("plataforma_admins").select("user_id").eq("user_id", s.user.id).maybeSingle(),
      supabase.from("org_membros").select("papel, org:organizacoes(*)").eq("user_id", s.user.id),
    ]);
    const m = (membros || [])[0] || null;
    _ctx = {
      user: s.user,
      email: s.user.email,
      superAdmin: !!adm,
      org: m?.org || null,
      papel: m?.papel || null,
      acesso: m?.org?.acesso || "tudo",
    };
  } catch {
    // banco ainda sem as tabelas de plataforma (pré-migração 0016)
    _ctx = { user: s.user, email: s.user.email, superAdmin: false, org: null, papel: null, acesso: "tudo" };
  }
  return _ctx;
}

export function limparContexto() { _ctx = undefined; }

export async function sair() {
  await supabase.auth.signOut().catch(() => {});
  _ctx = undefined;
  location.replace("/login.html");
}

/* ---- Níveis de acesso ------------------------------------------------- */
// grupos do menu que cada nível enxerga
export const CLUSTERS_POR_ACESSO = {
  tudo:       ["Geral", "Evento", "Anfitriões"],
  eventos:    ["Geral", "Evento"],
  anfitrioes: ["Anfitriões"],
};
const CLUSTER_DA_CHAVE = {
  geral: "Geral",
  "painel-evento": "Evento", ingressos: "Evento", participantes: "Evento",
  checkin: "Evento", atividades: "Evento", relatorios: "Evento",
  painel: "Anfitriões", anfitrioes: "Anfitriões", convidados: "Anfitriões", formulario: "Anfitriões",
  config: "*", integracoes: "*", eventos: "*",   // sempre visíveis (rodapé)
  plataforma: "plataforma",
};
const HOME_POR_ACESSO = { tudo: "index.html", eventos: "painel-evento.html", anfitrioes: "index.html" };

export function homeDoAcesso(ctx) {
  return HOME_POR_ACESSO[ctx?.acesso || "tudo"] || "index.html";
}

// true se a tela pode ser aberta; senão redireciona e devolve false
export function guardAcesso(chave, ctx) {
  if (!ctx) { irParaLogin(); return false; }
  const cluster = CLUSTER_DA_CHAVE[chave] || "*";
  if (ctx.superAdmin) {
    // super-admin só vê a visão gerencial + as organizações
    if (chave === "geral" || chave === "plataforma") return true;
    location.replace("geral.html");
    return false;
  }
  if (cluster === "plataforma") { location.replace(homeDoAcesso(ctx)); return false; }
  if (cluster === "*") return true;
  if ((CLUSTERS_POR_ACESSO[ctx.acesso] || CLUSTERS_POR_ACESSO.tudo).includes(cluster)) return true;
  location.replace(homeDoAcesso(ctx));
  return false;
}

export function planoBloqueado(ctx) {
  const o = ctx?.org;
  if (!o) return null;
  if (!o.ativo) return "Organização inativa. A criação de eventos está bloqueada — fale com o suporte.";
  if (o.expira_em && o.expira_em < new Date().toISOString().slice(0, 10))
    return `Plano expirado em ${o.expira_em.split("-").reverse().join("/")}. A criação de eventos está bloqueada.`;
  return null;
}
