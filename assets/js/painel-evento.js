// =============================================================================
// Painel do evento — visão geral de inscrições: KPIs (inscritos, confirmados,
// não vão, faturamento estimado) + barras por categoria, tipo e situação.
// Faturamento = soma do preço do tipo de ingresso (texto livre) × inscritos.
// Tudo client-side, sem lib de gráfico.
// =============================================================================
import { iniciarPagina, esc, formatarData, normalizarFaturamento } from "./ui.js";
import { listParticipantes, listTiposIngresso, listCamposPersonalizados } from "./supabase.js";

const _iniciando = iniciarPagina("painel-evento");
const el = (id) => document.getElementById(id);

let participantes = [];
let tipos = [];
let camposPersonalizados = [];

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
    [participantes, tipos, camposPersonalizados] = await Promise.all([
      listParticipantes(),
      listTiposIngresso().catch(() => []),
      listCamposPersonalizados().catch(() => []),
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

  // % sobre o total de inscritos (o card Inscritos é o topo do funil)
  const total = participantes.length;
  const pct = (n) => (total ? `${(Math.round((n / total) * 1000) / 10).toLocaleString("pt-BR")}%` : "0%");
  const kpi = (valor, rotulo, n) =>
    `<div class="card"><div class="kpi"><span class="valor">${valor}</span><span class="rotulo">${esc(rotulo)}</span>${n === undefined ? "" : `<span class="pct" title="${pct(n)} do total de inscritos">${pct(n)} dos inscritos</span>`}</div></div>`;
  el("kpis").innerHTML =
    kpi(total, "Inscritos") +
    kpi(conf, "Confirmados", conf) +
    kpi(pendentes, "Pendentes / pré-inscritos", pendentes) +
    kpi(fila, "Fila de espera") +
    kpi(naoVao, "Não vão", naoVao) +
    kpi(brl(faturamento), "Faturamento estimado");

  // Os gráficos contam TODOS os inscritos (inclusive Desativado), pra bater com o card Inscritos.
  // Só o faturamento fica de fora quem não vai.
  renderDias(participantes);
  renderQuebraConfirmados("rel-categoria", participantes, catDe);
  renderQuebraConfirmados("rel-tipo", participantes, (p) => p.tipo || "—");
  renderQuebra("rel-situacao", participantes, situ, SITUACOES);
  renderFaturamento(ativos);
  renderClusterTipoFaturamento(participantes);
  renderQuebra("rel-faturamento-perfil", participantes, (p) => normalizarFaturamento(p.faturamento) || "Não informado");
  renderCamposPersonalizados(participantes);
}

/* ---- Gráfico agrupado: tipo de participante (grupos) × faixa de faturamento (barras) ---------------------- */
// Filtro de situação: "Todas" ou uma das SITUACOES. Lembra a última escolha neste navegador.
let filtroSituacaoCl = "Todas";
try { const s = localStorage.getItem("painel_cl_situacao"); if (s) filtroSituacaoCl = s; } catch {}

const SEM_FAT = "Não informado";
// ordena as faixas pelo menor valor citado ("50 mil – 150 mil/mês" < "150 mil – 500 mil/mês" < "Acima de 1 milhão");
// "Não informado" sempre por último
function valorFaixa(txt) {
  const s = String(txt).toLowerCase().replace(/\./g, "").replace(",", ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(milh[õo]es|milh[ãa]o|mi\b|mil|k\b)?/);
  if (!m) return Infinity;
  let n = parseFloat(m[1]);
  const u = m[2] || "";
  if (/^milh/.test(u) || u === "mi") n *= 1_000_000; else if (u === "mil" || u === "k") n *= 1000;
  // "Até X" fica antes das faixas que começam em X; "Acima de X" depois
  if (/^\s*(at[eé]|menos|abaixo)/.test(s)) n -= 0.5;
  if (/^\s*(acima|mais|maior)/.test(s)) n += 0.5;
  return n;
}
const ordenarFaixas = (a, b) =>
  (a === SEM_FAT) - (b === SEM_FAT) || valorFaixa(a) - valorFaixa(b) || a.localeCompare(b, "pt-BR", { numeric: true });
// rampa sequencial (claro → escuro) pelas faixas em ordem; "Não informado" em cinza
const corFaixa = (i, n, faixa) =>
  faixa === SEM_FAT ? "var(--cinza-400)" : `hsl(262 78% ${n <= 1 ? 52 : Math.round(76 - (i / (n - 1)) * 40)}%)`;

function renderClusterTipoFaturamento(todos) {
  const chips = el("cl-chips");
  if (!chips) return;
  const contagem = (s) => (s === "Todas" ? todos.length : todos.filter((p) => situ(p) === s).length);
  if (filtroSituacaoCl !== "Todas" && !SITUACOES.includes(filtroSituacaoCl)) filtroSituacaoCl = "Todas";
  chips.innerHTML = ["Todas", ...SITUACOES].map((s) =>
    `<button type="button" class="cl-chip${s === filtroSituacaoCl ? " ativo" : ""}" data-sit="${esc(s)}" aria-pressed="${s === filtroSituacaoCl}">${esc(s)} <span class="cl-chip-n">${contagem(s)}</span></button>`).join("");
  chips.querySelectorAll("[data-sit]").forEach((b) => {
    b.onclick = () => {
      filtroSituacaoCl = b.dataset.sit;
      try { localStorage.setItem("painel_cl_situacao", filtroSituacaoCl); } catch {}
      renderClusterTipoFaturamento(todos);
    };
  });

  const dados = filtroSituacaoCl === "Todas" ? todos : todos.filter((p) => situ(p) === filtroSituacaoCl);
  const plot = el("cl-plot"), leg = el("cl-legenda");
  if (!dados.length) {
    leg.innerHTML = "";
    plot.innerHTML = `<p class="pagina-sub" style="margin:0">Nenhum participante com a situação <b>${esc(filtroSituacaoCl)}</b>.</p>`;
    return;
  }
  const tiposDe = new Map();      // tipo → Map(faixa → n)
  const faixasSet = new Set();
  dados.forEach((p) => {
    const t = (p.tipo || "").trim() || "—";
    const f = normalizarFaturamento(p.faturamento) || SEM_FAT;
    faixasSet.add(f);
    const m = tiposDe.get(t) || new Map();
    m.set(f, (m.get(f) || 0) + 1);
    tiposDe.set(t, m);
  });
  const faixas = [...faixasSet].sort(ordenarFaixas);
  const cor = new Map(faixas.map((f, i) => [f, corFaixa(i, faixas.length, f)]));
  const grupos = [...tiposDe.entries()]
    .map(([t, m]) => ({ t, m, tot: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.tot - a.tot);
  const maior = Math.max(1, ...grupos.flatMap((g) => [...g.m.values()]));

  const totalPorFaixa = (f) => grupos.reduce((s, g) => s + (g.m.get(f) || 0), 0);
  leg.innerHTML = faixas.map((f) =>
    `<span class="cl-leg"><i style="background:${cor.get(f)}"></i>${esc(f)} <b>${totalPorFaixa(f)}</b></span>`).join("");

  plot.innerHTML = grupos.map((g) => `<div class="cl-grupo">
      <div class="cl-barras">${faixas.map((f) => {
        const n = g.m.get(f) || 0;
        return `<div class="cl-col" title="${esc(g.t)} · ${esc(f)}: ${n} participante${n === 1 ? "" : "s"}">
          <span class="cl-val">${n || ""}</span>
          <div class="cl-barra" style="height:${n ? Math.max(3, Math.round((n / maior) * 88)) : 0}%;background:${cor.get(f)}"></div>
        </div>`;
      }).join("")}</div>
      <div class="cl-rotulo" title="${esc(g.t)}">${esc(g.t)}<span class="cl-rotulo-n">${g.tot}</span></div>
    </div>`).join("");
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

// Barras com "confirmados / inscritos": a barra clara é o total da linha e a sólida, os confirmados
// (situação do participante = Confirmado). Ordena por confirmados e, no empate, pelo total.
function renderQuebraConfirmados(alvo, dados, chave) {
  const mapa = new Map();
  dados.forEach((p) => {
    const k = chave(p);
    const l = mapa.get(k) || { tot: 0, conf: 0 };
    l.tot++;
    if (situ(p) === "Confirmado") l.conf++;
    mapa.set(k, l);
  });
  const linhas = [...mapa.entries()].sort((a, b) => b[1].conf - a[1].conf || b[1].tot - a[1].tot);
  if (!linhas.length) { el(alvo).innerHTML = `<p class="pagina-sub" style="margin:0">Sem dados.</p>`; return; }
  const maior = Math.max(1, ...linhas.map(([, l]) => l.tot));
  el(alvo).innerHTML = linhas
    .map(([k, l]) => `<div class="rel-barra" title="${l.conf} confirmados de ${l.tot} inscritos">
        <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
        <span class="rel-barra-trilha rel-barra-dupla">
          <i class="tot" style="width:${Math.round((l.tot / maior) * 100)}%"></i>
          <i style="width:${Math.round((l.conf / maior) * 100)}%"></i>
        </span>
        <span class="rel-barra-valor">${l.conf}<span class="rel-barra-de"> / ${l.tot}</span></span>
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

// valores de um campo personalizado pra um participante (texto/única = 1 valor; múltipla = N)
function valoresCampo(campo, p) {
  const v = p.campos_extra?.[campo.chave];
  if (campo.tipo === "multipla_escolha") return Array.isArray(v) && v.length ? v : ["— não preenchido —"];
  return [v || "— não preenchido —"];
}

function renderCamposPersonalizados(dados) {
  const wrap = el("rel-campos");
  const ativos = camposPersonalizados.filter((c) => c.ativo);
  if (!ativos.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = ativos.map((c) => {
    const mapa = new Map();
    dados.forEach((p) => valoresCampo(c, p).forEach((v) => mapa.set(v, (mapa.get(v) || 0) + 1)));
    const total = dados.length || 1;
    const linhas = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="rel-secao">
      <h2>${esc(c.nome)}</h2>
      ${linhas.map(([k, n]) => {
        const pct = Math.round((n / total) * 100);
        return `<div class="rel-barra">
          <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
          <span class="rel-barra-trilha"><i style="width:${pct}%"></i></span>
          <span class="rel-barra-valor">${n}</span>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
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
