// =============================================================================
// Painel do evento — visão geral de inscrições: KPIs (inscritos, confirmados,
// não vão, faturamento estimado) + barras por categoria, tipo e situação.
// Faturamento = soma do preço do tipo de ingresso (texto livre) × inscritos.
// Tudo client-side, sem lib de gráfico.
// =============================================================================
import { iniciarPagina, esc, formatarData } from "./ui.js";
import { listParticipantes, listTiposIngresso } from "./supabase.js";

const _iniciando = iniciarPagina("painel-evento");
const el = (id) => document.getElementById(id);

let participantes = [];
let tipos = [];

const SITUACOES = ["Confirmado", "Pendente", "Fila de espera", "Pré-inscrito", "Desativado"];
const situ = (p) => p.situacao || "Confirmado";
const ativo = (p) => situ(p) !== "Desativado";
const catDe = (p) => (p.ingresso || "").trim() || "Sem categoria";

// "R$ 1.500,00" / "1500" / "Gratuito" → número
function parsePreco(txt) {
  const s = String(txt || "").replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const n = parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
const brl = (n) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n % 1 ? 2 : 0 });

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });
el("btn-atualizar").onclick = () => carregar();

async function carregar() {
  try {
    [participantes, tipos] = await Promise.all([
      listParticipantes(),
      listTiposIngresso().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /participantes|does not exist/.test(e.message || "")
      ? `Rode a migração <code>supabase/migrations/0004_participantes.sql</code> para ativar esta tela.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

const precoDaCategoria = (nome) => {
  const t = tipos.find((x) => (x.nome || "").trim().toLowerCase() === nome.trim().toLowerCase());
  return t ? parsePreco(t.preco) : 0;
};

function render() {
  const ativos = participantes.filter(ativo);
  const conf = participantes.filter((p) => situ(p) === "Confirmado").length;
  const naoVao = participantes.filter((p) => situ(p) === "Desativado").length;
  const pendentes = participantes.filter((p) => ["Pendente", "Pré-inscrito"].includes(situ(p))).length;
  const fila = participantes.filter((p) => situ(p) === "Fila de espera").length;
  const faturamento = ativos.reduce((s, p) => s + precoDaCategoria(catDe(p)) * (Number(p.quantidade) || 1), 0);

  const kpi = (valor, rotulo) =>
    `<div class="card"><div class="kpi"><span class="valor">${valor}</span><span class="rotulo">${esc(rotulo)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(ativos.length, "Inscritos") +
    kpi(conf, "Confirmados") +
    kpi(pendentes, "Pendentes / pré-inscritos") +
    kpi(fila, "Fila de espera") +
    kpi(naoVao, "Não vão") +
    kpi(brl(faturamento), "Faturamento estimado");

  renderDias(ativos);
  renderQuebra("rel-categoria", ativos, catDe);
  renderQuebra("rel-tipo", ativos, (p) => p.tipo || "—");
  renderQuebra("rel-situacao", participantes, situ, SITUACOES);
  renderFaturamento(ativos);
}

function renderDias(dados) {
  const dias = [];
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoje); d.setDate(d.getDate() - i);
    dias.push({ d, n: 0 });
  }
  dados.forEach((p) => {
    const t = new Date(p.created_at); t.setHours(0, 0, 0, 0);
    const slot = dias.find((x) => x.d.getTime() === t.getTime());
    if (slot) slot.n++;
  });
  const max = Math.max(1, ...dias.map((x) => x.n));
  el("rel-dias").innerHTML = dias
    .map(({ d, n }) => `<div class="rel-hora" title="${n} em ${formatarData(d.toISOString())}">
      <span class="rel-hora-n">${n || ""}</span>
      <div class="rel-hora-barra" style="height:${Math.round((n / max) * 92)}%"></div>
      <span class="rel-hora-h">${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</span>
    </div>`)
    .join("");
}

function renderQuebra(alvo, dados, chave, ordemFixa) {
  const mapa = new Map();
  dados.forEach((p) => { const k = chave(p); mapa.set(k, (mapa.get(k) || 0) + 1); });
  let linhas = [...mapa.entries()];
  if (ordemFixa) linhas.sort((a, b) => ordemFixa.indexOf(a[0]) - ordemFixa.indexOf(b[0]));
  else linhas.sort((a, b) => b[1] - a[1]);
  const total = dados.length || 1;
  if (!linhas.length) { el(alvo).innerHTML = `<p class="pagina-sub" style="margin:0">Sem dados.</p>`; return; }
  el(alvo).innerHTML = linhas
    .map(([k, n]) => {
      const pct = Math.round((n / total) * 100);
      return `<div class="rel-barra">
        <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
        <span class="rel-barra-trilha"><i style="width:${pct}%"></i></span>
        <span class="rel-barra-valor">${n}</span>
      </div>`;
    })
    .join("");
}

function renderFaturamento(dados) {
  const mapa = new Map();
  dados.forEach((p) => {
    const k = catDe(p);
    mapa.set(k, (mapa.get(k) || 0) + precoDaCategoria(k) * (Number(p.quantidade) || 1));
  });
  const linhas = [...mapa.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...linhas.map(([, v]) => v));
  if (!linhas.length) {
    el("rel-faturamento").innerHTML = `<p class="pagina-sub" style="margin:0">Defina os preços em <b>Tipos de ingresso</b> para ver o faturamento.</p>`;
    return;
  }
  el("rel-faturamento").innerHTML = linhas
    .map(([k, v]) => `<div class="rel-barra">
      <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
      <span class="rel-barra-trilha"><i style="width:${Math.round((v / max) * 100)}%"></i></span>
      <span class="rel-barra-valor">${esc(brl(v))}</span>
    </div>`)
    .join("");
}
