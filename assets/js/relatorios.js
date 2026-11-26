// =============================================================================
// Relatórios de credenciamento — KPIs, presença por ingresso/tipo, check-ins
// por hora e lista dos últimos check-ins. Tudo client-side, sem lib de gráfico.
// =============================================================================
import { iniciarPagina, esc, debounce, formatarData, toast, normalizarFaturamento } from "./ui.js";
import { listParticipantes, listParticipantesAoVivo, listCheckins, listAtividades, listTiposIngresso, listPontos, listAcessosPontos } from "./supabase.js";
import { baixarXLSX } from "./tabela.js";

const _iniciando = iniciarPagina("relatorios");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let atividades = [];
let tipos = [];
let pontos = [];          // pontos de controle (0047)
let acessosPontos = [];   // entradas/saídas nos pontos (check-in = controle de acesso)
let diaPonto = null;      // null = ainda não escolhido; "" = todos os dias; senão AAAA-MM-DD
let buscaLog = "";
let modoFaturamentoPerfil = "inscritos";

// "R$ 1.500,00" / "1500" / "Gratuito" → número
function parsePreco(txt) {
  const s = String(txt || "").replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const n = parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
const brl = (n) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n % 1 ? 2 : 0 });
const precoDaCategoria = (nome) => {
  const t = tipos.find((x) => (x.nome || "").trim().toLowerCase() === (nome || "").trim().toLowerCase());
  return t ? parsePreco(t.preco) : 0;
};

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });
el("btn-atualizar").onclick = () => carregar();
el("btn-exportar").onclick = exportar;
el("busca-log").addEventListener("input", debounce((e) => { buscaLog = e.target.value.trim().toLowerCase(); renderLog(); }, 200));
el("toggle-faturamento-perfil").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    el("toggle-faturamento-perfil").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
    b.classList.add("ativo");
    modoFaturamentoPerfil = b.dataset.modo;
    renderFaturamentoPerfil();
  };
});
// atualização automática: nunca começa outra enquanto a anterior não terminou (com internet lenta elas se acumulavam)
let atualizandoSozinho = false;
setInterval(async () => {
  if (document.hidden || atualizandoSozinho) return;
  atualizandoSozinho = true;
  try { await carregar(true); } finally { atualizandoSozinho = false; }
}, 30000);

// soMudancas: só a atualização automática usa (baixa apenas os participantes alterados)
async function carregar(soMudancas) {
  try {
    [participantes, checkins, atividades, tipos, pontos, acessosPontos] = await Promise.all([
      listParticipantesAoVivo(soMudancas === true), listCheckins(), listAtividades().catch(() => []), listTiposIngresso().catch(() => []),
      listPontos().catch(() => []), listAcessosPontos().catch(() => []),   // sem a migração 0047 simplesmente não aparece
    ]);
    participantes = participantes.filter((p) => p.situacao !== "Desativado");
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    const falta = /checkins|schema cache|does not exist/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0007_checkins.sql</code> no SQL Editor do Supabase para ativar os relatórios.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

const hora = (iso) => {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
};
const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const nomeAtividade = (id) => (id && atividades.find((a) => a.id === id)?.nome) || "Credenciamento";
const nomePonto = (id) => pontos.find((p) => p.id === id)?.nome || "Ponto removido";
const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const diaSP = (iso) => { try { return FMT_DIA.format(new Date(iso)); } catch { return ""; } };
const dataBR = (aaaammdd) => { const [a, m, d] = aaaammdd.split("-"); return `${d}/${m}/${a}`; };

function render() {
  renderKpis();
  renderDias();
  renderHoras();
  renderPontos();
  renderQuebra("rel-ingresso", (p) => p.ingresso || "Sem categoria");
  renderQuebra("rel-tipo", (p) => p.tipo || "—");
  renderFaturamentoPerfil();
  renderAtividades();
  renderLog();
}

// Check-ins por ponto de controle: ÚNICOS por dia — cada pessoa conta 1 vez por ponto/dia, mesmo bipada várias vezes.
// dia = "" soma os dias (cada dia com suas pessoas únicas).
function checkinsPorPonto(dia) {
  const unicos = new Map();   // ponto_id → Set("dia|participante")
  acessosPontos.forEach((a) => {
    if (a.acao !== "entrada") return;
    const d = diaSP(a.at);
    if (dia && d !== dia) return;
    const s = unicos.get(a.ponto_id) || new Set();
    s.add(`${d}|${a.participante_id}`);
    unicos.set(a.ponto_id, s);
  });
  return unicos;
}

function renderPontos() {
  const sec = el("sec-pontos");
  if (!pontos.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const dias = [...new Set(acessosPontos.filter((a) => a.acao === "entrada").map((a) => diaSP(a.at)))].sort().reverse();
  if (diaPonto === null) diaPonto = dias.includes(diaSP(new Date().toISOString())) ? diaSP(new Date().toISOString()) : "";
  if (diaPonto && !dias.includes(diaPonto)) diaPonto = "";
  el("rel-pontos-dia").innerHTML = `<option value="">Todos os dias</option>` +
    dias.map((d) => `<option value="${d}" ${d === diaPonto ? "selected" : ""}>${dataBR(d)}</option>`).join("");
  el("rel-pontos-dia").onchange = (e) => { diaPonto = e.target.value; renderPontos(); };

  const unicos = checkinsPorPonto(diaPonto);
  const linhas = pontos.map((p) => ({ nome: p.nome, n: unicos.get(p.id)?.size || 0, ativo: p.ativo }));
  const max = Math.max(1, ...linhas.map((l) => l.n));
  // sem linha de "Total": a mesma pessoa pode passar em vários pontos, então somar os pontos repetiria gente
  el("rel-pontos").innerHTML = linhas
    .map((l) => `<div class="rel-barra">
        <span class="rel-barra-nome" title="${esc(l.nome)}">${esc(l.nome)}${l.ativo ? "" : " (inativo)"}</span>
        <span class="rel-barra-trilha"><i style="width:${Math.round((l.n / max) * 100)}%"></i></span>
        <span class="rel-barra-valor">${l.n}</span>
      </div>`).join("");
}

function renderAtividades() {
  const sec = el("sec-atividades");
  if (!atividades.length) { sec.hidden = true; return; }
  sec.hidden = false;
  el("rel-atividades").innerHTML = atividades
    .map((a) => {
      const saldo = new Map();
      checkins.forEach((c) => {
        if (c.atividade_id !== a.id) return;
        saldo.set(c.participante_id, (saldo.get(c.participante_id) || 0) + (c.acao === "entrada" ? 1 : -1));
      });
      const n = [...saldo.values()].filter((v) => v > 0).length;
      const base = a.vagas || Math.max(n, 1);
      const pct = Math.min(100, Math.round((n / base) * 100));
      return `<div class="rel-barra">
        <span class="rel-barra-nome" title="${esc(a.nome)}">${esc(a.nome)}</span>
        <span class="rel-barra-trilha"><i style="width:${pct}%"></i></span>
        <span class="rel-barra-valor">${a.vagas ? `${n}/${a.vagas}` : n}</span>
      </div>`;
    })
    .join("");
}

function renderKpis() {
  const total = participantes.length;
  const presentes = participantes.filter((p) => p.presente).length;
  const t0 = hoje0().getTime();
  const agora = Date.now();
  const entradas = checkins.filter((c) => c.acao === "entrada");
  const hoje = entradas.filter((c) => new Date(c.at).getTime() >= t0).length;
  const ultimaHora = entradas.filter((c) => agora - new Date(c.at).getTime() <= 3600000).length;
  const taxa = total ? Math.round((presentes / total) * 100) : 0;

  // só mostra faturamento se algum Tipo de ingresso tiver preço configurado
  const temPreco = tipos.some((t) => parsePreco(t.preco) > 0);
  const valorDe = (p) => precoDaCategoria(p.ingresso) * (Number(p.quantidade) || 1);
  const faturamentoInscrito = temPreco ? participantes.reduce((s, p) => s + valorDe(p), 0) : 0;
  const faturamentoPresente = temPreco ? participantes.filter((p) => p.presente).reduce((s, p) => s + valorDe(p), 0) : 0;

  const kpi = (valor, rotulo) => `<div class="card"><div class="kpi"><span class="valor">${valor}</span><span class="rotulo">${esc(rotulo)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(total, "Participantes") +
    kpi(presentes, "Presentes agora") +
    kpi(hoje, "Credenciados hoje") +
    (temPreco ? kpi(brl(faturamentoInscrito), "Faturamento inscrito") + kpi(brl(faturamentoPresente), "Faturamento presente") : "") +
    kpi(ultimaHora, "Na última hora") +
    kpi(taxa + "%", "Taxa de presença");
}

function renderDias() {
  const entradas = checkins.filter((c) => c.acao === "entrada");
  if (!entradas.length) {
    el("rel-dias").innerHTML = `<p class="pagina-sub" style="margin:auto">Nenhum credenciamento registrado ainda.</p>`;
    return;
  }
  const hoje = hoje0();
  const MAX_DIAS = 30;
  let primeiro = new Date(Math.min(...entradas.map((c) => new Date(c.at).getTime())));
  primeiro.setHours(0, 0, 0, 0);
  if ((hoje - primeiro) / 86400000 > MAX_DIAS) primeiro = new Date(hoje.getTime() - MAX_DIAS * 86400000);

  const dias = [];
  for (let d = new Date(primeiro); d <= hoje; d.setDate(d.getDate() + 1)) dias.push({ d: new Date(d), n: 0 });
  entradas.forEach((c) => {
    const t = new Date(c.at); t.setHours(0, 0, 0, 0);
    const slot = dias.find((x) => x.d.getTime() === t.getTime());
    if (slot) slot.n++;
  });
  const max = Math.max(1, ...dias.map((x) => x.n));
  el("rel-dias").innerHTML = dias
    .map(({ d, n }) => `<div class="rel-hora" title="${n} credenciamento(s) em ${formatarData(d.toISOString())}">
      <span class="rel-hora-n">${n || ""}</span>
      <div class="rel-hora-barra" style="height:${Math.round((n / max) * 92)}%"></div>
      <span class="rel-hora-h">${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</span>
    </div>`)
    .join("");
}

function renderHoras() {
  const t0 = hoje0().getTime();
  const porHora = Array(24).fill(0);
  checkins.forEach((c) => {
    if (c.acao !== "entrada") return;
    const d = new Date(c.at);
    if (d.getTime() >= t0) porHora[d.getHours()]++;
  });
  const max = Math.max(1, ...porHora);
  // mostra da 1ª hora com movimento (ou 7h) até a última (ou 22h)
  let ini = porHora.findIndex((n) => n > 0);
  let fim = porHora.length - 1 - [...porHora].reverse().findIndex((n) => n > 0);
  if (ini < 0) { ini = 7; fim = 22; }
  ini = Math.min(ini, 7); fim = Math.max(fim, Math.min(ini + 6, 22));

  let barras = "";
  for (let h = ini; h <= fim; h++) {
    const n = porHora[h];
    barras += `<div class="rel-hora" title="${n} credenciamento(s) às ${h}h">
      <span class="rel-hora-n">${n || ""}</span>
      <div class="rel-hora-barra" style="height:${Math.round((n / max) * 92)}%"></div>
      <span class="rel-hora-h">${h}h</span>
    </div>`;
  }
  el("rel-horas").innerHTML = barras;
}

function renderQuebra(alvo, chave) {
  const mapa = new Map();
  participantes.forEach((p) => {
    const k = chave(p);
    const m = mapa.get(k) || { total: 0, presentes: 0 };
    m.total++;
    if (p.presente) m.presentes++;
    mapa.set(k, m);
  });
  const linhas = [...mapa.entries()].sort((a, b) => b[1].total - a[1].total);
  if (!linhas.length) { el(alvo).innerHTML = `<p class="pagina-sub" style="margin:0">Sem dados.</p>`; return; }
  el(alvo).innerHTML = linhas
    .map(([k, m]) => {
      const pct = m.total ? Math.round((m.presentes / m.total) * 100) : 0;
      return `<div class="rel-barra">
        <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
        <span class="rel-barra-trilha"><i style="width:${pct}%"></i></span>
        <span class="rel-barra-valor">${m.presentes}/${m.total}</span>
      </div>`;
    })
    .join("");
}

// Igual renderQuebra, mas com toggle pra escolher entre ver o número (e a
// barra) de inscritos ou só de presentes, em vez de sempre misturar os dois.
function renderFaturamentoPerfil() {
  const mapa = new Map();
  participantes.forEach((p) => {
    const k = normalizarFaturamento(p.faturamento) || "Não informado";
    const m = mapa.get(k) || { total: 0, presentes: 0 };
    m.total++;
    if (p.presente) m.presentes++;
    mapa.set(k, m);
  });
  const usarPresentes = modoFaturamentoPerfil === "presentes";
  const valor = (m) => (usarPresentes ? m.presentes : m.total);
  const linhas = [...mapa.entries()].sort((a, b) => valor(b[1]) - valor(a[1]));
  if (!linhas.length) { el("rel-faturamento-perfil").innerHTML = `<p class="pagina-sub" style="margin:0">Sem dados.</p>`; return; }
  const max = Math.max(1, ...linhas.map(([, m]) => valor(m)));
  el("rel-faturamento-perfil").innerHTML = linhas
    .map(([k, m]) => {
      const n = valor(m);
      const pct = Math.round((n / max) * 100);
      return `<div class="rel-barra">
        <span class="rel-barra-nome" title="${esc(k)}">${esc(k)}</span>
        <span class="rel-barra-trilha"><i style="width:${pct}%"></i></span>
        <span class="rel-barra-valor">${n}</span>
      </div>`;
    })
    .join("");
}

// uma lista só, do mais novo pro mais antigo: credenciamento do evento, atividades e pontos de controle
function registrosUnificados() {
  const doEvento = checkins.map((c) => ({
    acao: c.acao, p: c.participante || {}, at: c.at,
    onde: nomeAtividade(c.atividade_id), operador: "",
  }));
  const dosPontos = acessosPontos.map((a) => ({
    acao: a.acao, p: a.participante || {}, at: a.at,
    onde: `Ponto: ${nomePonto(a.ponto_id)}`, operador: a.operador || "",
  }));
  return [...doEvento, ...dosPontos].sort((x, y) => new Date(y.at) - new Date(x.at));
}

function logFiltrado() {
  const todos = registrosUnificados();
  if (!buscaLog) return todos;
  return todos.filter((r) => {
    const p = r.p;
    return `${p.nome || ""} ${p.email || ""} ${p.codigo || ""} ${p.empresa || ""} ${r.onde}`.toLowerCase().includes(buscaLog);
  });
}

function renderLog() {
  const dados = logFiltrado().slice(0, 200);
  el("wrap-log").hidden = dados.length === 0;
  el("vazio-log").hidden = dados.length !== 0;
  if (!dados.length) return;
  el("linhas-log").innerHTML = dados
    .map((r) => {
      const p = r.p;
      const ent = r.acao === "entrada";
      return `<tr>
        <td><span class="badge ${ent ? "badge-ok" : "badge-erro"}">${ent ? "Entrada" : "Saída"}</span></td>
        <td><strong>${esc(p.nome || "—")}</strong>${p.tipo ? ` <span class="cel-tenue">· ${esc(p.tipo)}</span>` : ""}</td>
        <td>${esc(p.ingresso || "—")}</td>
        <td>${esc(r.onde)}</td>
        <td>${formatarData(r.at)} ${esc(hora(r.at))}</td>
      </tr>`;
    })
    .join("");
}
async function exportar() {
  const dados = logFiltrado();
  if (!dados.length) { toast("Nada para exportar.", "erro"); return; }
  await baixarXLSX("registros-de-acesso.xlsx", dados, [
    { rotulo: "Ação", valor: (r) => (r.acao === "entrada" ? "Entrada" : "Saída") },
    { rotulo: "Participante", valor: (r) => r.p.nome || "" },
    { rotulo: "Categoria", valor: (r) => r.p.ingresso || "" },
    { rotulo: "Tipo", valor: (r) => r.p.tipo || "" },
    { rotulo: "Onde", valor: (r) => r.onde },
    { rotulo: "Operador", valor: (r) => r.operador },
    { rotulo: "E-mail", valor: (r) => r.p.email || "" },
    { rotulo: "Código", valor: (r) => r.p.codigo || "" },
    { rotulo: "Data", valor: (r) => formatarData(r.at) },
    { rotulo: "Hora", valor: (r) => hora(r.at) },
  ]);  toast("Arquivo gerado.", "ok");
}
