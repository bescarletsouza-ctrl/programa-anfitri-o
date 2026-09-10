// =============================================================================
// Visão geral — painel compilado de TODOS os eventos cadastrados. Não é escopado
// por evento (não usa iniciarPagina). Junta participantes, presença, check-ins,
// faturamento e anfitriões de todo o histórico. Gráficos em CSS, sem lib.
// =============================================================================
import { renderSidebar, esc, formatarData } from "./ui.js";
import {
  listEventos, listParticipantesTodos, listCheckinsTodos,
  listAnfitrioesTodos, listTiposIngressoTodos,
} from "./supabase.js";

renderSidebar("geral");
const el = (id) => document.getElementById(id);

let eventos = [], parts = [], checks = [], anfs = [], tipos = [];

const SITUACOES = ["Confirmado", "Pendente", "Fila de espera", "Pré-inscrito", "Desativado"];
const situ = (p) => p.situacao || "Confirmado";
const ativo = (p) => situ(p) !== "Desativado";
const catDe = (p) => (p.ingresso || "").trim() || "Sem categoria";

function parsePreco(txt) {
  const s = String(txt || "").replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const n = parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n % 1 ? 2 : 0 });

carregar();
el("btn-atualizar").onclick = () => carregar();

async function carregar() {
  try {
    [eventos, parts, checks, anfs, tipos] = await Promise.all([
      listEventos(),
      listParticipantesTodos(),
      listCheckinsTodos().catch(() => []),
      listAnfitrioesTodos().catch(() => []),
      listTiposIngressoTodos().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /participantes|eventos|does not exist|schema cache/.test(e.message || "")
      ? "Rode as migrações no SQL Editor do Supabase para ativar esta tela."
      : "Erro ao carregar: " + esc(e.message);
  }
}

const precoDaCategoria = (eventoId, nome) => {
  const alvo = (nome || "").trim().toLowerCase();
  const t = tipos.find((x) => x.evento_id === eventoId && (x.nome || "").trim().toLowerCase() === alvo);
  return t ? parsePreco(t.preco) : 0;
};
const faturamentoEvento = (eventoId) =>
  parts.filter((p) => p.evento_id === eventoId && ativo(p))
    .reduce((s, p) => s + precoDaCategoria(eventoId, catDe(p)) * (Number(p.quantidade) || 1), 0);

function render() {
  const ativos = parts.filter(ativo);
  const presentes = ativos.filter((p) => p.presente).length;
  const inscritos = ativos.length;
  const confAnf = anfs.reduce((s, a) => s + (Number(a.confirmados) || 0), 0);
  const faturamento = eventos.reduce((s, ev) => s + faturamentoEvento(ev.id), 0);

  const kpi = (v, r) => `<div class="card"><div class="kpi"><span class="valor">${v}</span><span class="rotulo">${esc(r)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(eventos.length, "Eventos") +
    kpi(inscritos, "Inscritos (total)") +
    kpi(presentes, "Presentes") +
    kpi(inscritos - presentes, "Ausentes") +
    kpi(anfs.length, "Anfitriões") +
    kpi(confAnf, "Convidados confirmados") +
    kpi(brl(faturamento), "Faturamento estimado");

  renderEventos();
  renderQuebraEventos("rel-inscritos-evento", (ev) => parts.filter((p) => p.evento_id === ev.id && ativo(p)).length);
  renderPresencaEvento();
  renderDias();
  renderQuebra("rel-situacao", parts, situ, SITUACOES);
  renderQuebra("rel-tipo", ativos, (p) => p.tipo || "—");
  renderQuebra("rel-categoria", ativos, catDe);

  renderAnfitrioes();
}

/* ---- tabela por evento ---- */
function renderEventos() {
  const ordenados = [...eventos].sort((a, b) =>
    (b.data_evento || b.created_at || "").localeCompare(a.data_evento || a.created_at || ""));
  el("linhas-eventos").innerHTML = ordenados.map((ev) => {
    const lista = parts.filter((p) => p.evento_id === ev.id && ativo(p));
    const ins = lista.length;
    const pres = lista.filter((p) => p.presente).length;
    const pct = ins ? Math.round((pres / ins) * 100) : 0;
    return `<tr>
      <td><strong>${esc(ev.nome)}</strong>${ev.local ? `<span class="cel-tenue"> · ${esc(ev.local)}</span>` : ""}</td>
      <td>${ev.data_evento ? esc(formatarData(ev.data_evento)) : "—"}</td>
      <td class="num">${ins}</td>
      <td class="num">${pres}</td>
      <td class="num">${ins - pres}</td>
      <td><span class="rel-barra-trilha" style="max-width:120px;display:inline-block;vertical-align:middle"><i style="width:${pct}%"></i></span> <span class="cel-tenue">${pct}%</span></td>
      <td class="num">${esc(brl(faturamentoEvento(ev.id)))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="cel-tenue">Nenhum evento.</td></tr>`;
}

/* ---- barras ---- */
function renderQuebraEventos(alvo, valorFn) {
  const linhas = eventos.map((ev) => [ev.nome, valorFn(ev)]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...linhas.map(([, n]) => n));
  el(alvo).innerHTML = linhas.length
    ? linhas.map(([k, n]) => barra(k, n, Math.round((n / max) * 100), n)).join("")
    : semDados();
}

function renderPresencaEvento() {
  const linhas = eventos.map((ev) => {
    const lista = parts.filter((p) => p.evento_id === ev.id && ativo(p));
    const pres = lista.filter((p) => p.presente).length;
    return { nome: ev.nome, pres, tot: lista.length };
  }).filter((x) => x.tot > 0).sort((a, b) => b.pres - a.pres);
  el("rel-presenca-evento").innerHTML = linhas.length
    ? linhas.map((x) => barra(x.nome, `${x.pres}/${x.tot}`, x.tot ? Math.round((x.pres / x.tot) * 100) : 0)).join("")
    : semDados();
}

function renderQuebra(alvo, dados, chave, ordemFixa) {
  const mapa = new Map();
  dados.forEach((p) => { const k = chave(p); mapa.set(k, (mapa.get(k) || 0) + 1); });
  let linhas = [...mapa.entries()];
  if (ordemFixa) linhas.sort((a, b) => ordemFixa.indexOf(a[0]) - ordemFixa.indexOf(b[0]));
  else linhas.sort((a, b) => b[1] - a[1]);
  const total = dados.length || 1;
  el(alvo).innerHTML = linhas.length
    ? linhas.map(([k, n]) => barra(k, n, Math.round((n / total) * 100))).join("")
    : semDados();
}

function renderDias() {
  const entradas = checks.filter((c) => c.acao === "entrada" && !c.atividade_id);
  if (!entradas.length) { el("rel-dias").innerHTML = `<p class="pagina-sub" style="margin:auto">Nenhum check-in ainda.</p>`; return; }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const MAX = 30;
  let primeiro = new Date(Math.min(...entradas.map((c) => new Date(c.at).getTime())));
  primeiro.setHours(0, 0, 0, 0);
  if ((hoje - primeiro) / 86400000 > MAX) primeiro = new Date(hoje.getTime() - MAX * 86400000);
  const dias = [];
  for (let d = new Date(primeiro); d <= hoje; d.setDate(d.getDate() + 1)) dias.push({ d: new Date(d), n: 0 });
  entradas.forEach((c) => {
    const t = new Date(c.at); t.setHours(0, 0, 0, 0);
    const slot = dias.find((x) => x.d.getTime() === t.getTime());
    if (slot) slot.n++;
  });
  const max = Math.max(1, ...dias.map((x) => x.n));
  el("rel-dias").innerHTML = dias.map(({ d, n }) => `<div class="rel-hora" title="${n} em ${formatarData(d.toISOString())}">
    <span class="rel-hora-n">${n || ""}</span>
    <div class="rel-hora-barra" style="height:${Math.round((n / max) * 92)}%"></div>
    <span class="rel-hora-h">${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</span>
  </div>`).join("");
}

/* ---- anfitriões ---- */
function renderAnfitrioes() {
  const env = anfs.reduce((s, a) => s + (Number(a.enviados) || 0), 0);
  const apr = anfs.reduce((s, a) => s + (Number(a.aprovados) || 0), 0);
  const conf = anfs.reduce((s, a) => s + (Number(a.confirmados) || 0), 0);
  const taxa = env ? Math.round((conf / env) * 100) : 0;
  const kpi = (v, r) => `<div class="card"><div class="kpi"><span class="valor">${v}</span><span class="rotulo">${esc(r)}</span></div></div>`;
  el("kpis-anf").innerHTML =
    kpi(anfs.length, "Anfitriões") +
    kpi(env, "Convites enviados") +
    kpi(apr, "Aprovados") +
    kpi(conf, "Confirmados") +
    kpi(taxa + "%", "Conversão (confirm./enviados)");

  const max = Math.max(1, env);
  el("rel-funil").innerHTML =
    barra("Enviados", env, Math.round((env / max) * 100)) +
    barra("Aprovados", apr, Math.round((apr / max) * 100)) +
    barra("Confirmados", conf, Math.round((conf / max) * 100));

  const nomeEvento = (id) => eventos.find((e) => e.id === id)?.nome || "—";
  const porEvento = new Map();
  anfs.forEach((a) => porEvento.set(a.evento_id, (porEvento.get(a.evento_id) || 0) + 1));
  const le = [...porEvento.entries()].map(([id, n]) => [nomeEvento(id), n]).sort((a, b) => b[1] - a[1]);
  const maxE = Math.max(1, ...le.map(([, n]) => n));
  el("rel-anf-evento").innerHTML = le.length
    ? le.map(([k, n]) => barra(k, n, Math.round((n / maxE) * 100))).join("")
    : semDados();

  const top = [...anfs].filter((a) => (Number(a.confirmados) || 0) > 0)
    .sort((a, b) => (b.confirmados || 0) - (a.confirmados || 0)).slice(0, 12);
  const maxC = Math.max(1, ...top.map((a) => a.confirmados || 0));
  el("rel-top-anf").innerHTML = top.length
    ? top.map((a) => barra(`${a.nome} · ${nomeEvento(a.evento_id)}`, a.confirmados || 0, Math.round(((a.confirmados || 0) / maxC) * 100))).join("")
    : semDados();
}

/* ---- helpers de render ---- */
function barra(rotulo, valor, pct, valorNum) {
  return `<div class="rel-barra">
    <span class="rel-barra-nome" title="${esc(String(rotulo))}">${esc(String(rotulo))}</span>
    <span class="rel-barra-trilha"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>
    <span class="rel-barra-valor">${esc(String(valor))}</span>
  </div>`;
}
const semDados = () => `<p class="pagina-sub" style="margin:0">Sem dados.</p>`;
