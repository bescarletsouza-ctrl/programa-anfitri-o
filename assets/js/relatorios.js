// =============================================================================
// Relatórios de credenciamento — KPIs, presença por ingresso/tipo, check-ins
// por hora e lista dos últimos check-ins. Tudo client-side, sem lib de gráfico.
// =============================================================================
import { iniciarPagina, esc, debounce, formatarData, toast } from "./ui.js";
import { listParticipantes, listCheckins } from "./supabase.js";
import { gerarCSV, baixarCSV } from "./tabela.js";

iniciarPagina("relatorios");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let buscaLog = "";

carregar();
el("btn-atualizar").onclick = () => carregar();
el("btn-exportar").onclick = exportar;
el("busca-log").addEventListener("input", debounce((e) => { buscaLog = e.target.value.trim().toLowerCase(); renderLog(); }, 200));
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    [participantes, checkins] = await Promise.all([listParticipantes(), listCheckins()]);
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

function render() {
  renderKpis();
  renderHoras();
  renderQuebra("rel-ingresso", (p) => p.ingresso || "Sem categoria");
  renderQuebra("rel-tipo", (p) => p.tipo || "—");
  renderLog();
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

  const kpi = (valor, rotulo) => `<div class="card"><div class="kpi"><span class="valor">${valor}</span><span class="rotulo">${esc(rotulo)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(total, "Participantes") +
    kpi(presentes, "Presentes agora") +
    kpi(hoje, "Check-ins hoje") +
    kpi(ultimaHora, "Na última hora") +
    kpi(taxa + "%", "Taxa de presença");
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
    barras += `<div class="rel-hora" title="${n} check-in(s) às ${h}h">
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

function logFiltrado() {
  if (!buscaLog) return checkins;
  return checkins.filter((c) => {
    const p = c.participante || {};
    return `${p.nome || ""} ${p.email || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(buscaLog);
  });
}

function renderLog() {
  const dados = logFiltrado().slice(0, 200);
  el("wrap-log").hidden = dados.length === 0;
  el("vazio-log").hidden = dados.length !== 0;
  if (!dados.length) return;
  el("linhas-log").innerHTML = dados
    .map((c) => {
      const p = c.participante || {};
      const ent = c.acao === "entrada";
      return `<tr>
        <td><span class="badge ${ent ? "badge-ok" : "badge-erro"}">${ent ? "Entrada" : "Saída"}</span></td>
        <td><strong>${esc(p.nome || "—")}</strong>${p.tipo ? ` <span class="cel-tenue">· ${esc(p.tipo)}</span>` : ""}</td>
        <td>${esc(p.ingresso || "—")}</td>
        <td>${formatarData(c.at)} ${esc(hora(c.at))}</td>
      </tr>`;
    })
    .join("");
}

function exportar() {
  const dados = logFiltrado();
  if (!dados.length) { toast("Nada para exportar.", "erro"); return; }
  const csv = gerarCSV(dados, [
    { rotulo: "Ação", valor: (c) => (c.acao === "entrada" ? "Entrada" : "Saída") },
    { rotulo: "Participante", valor: (c) => c.participante?.nome || "" },
    { rotulo: "Categoria", valor: (c) => c.participante?.ingresso || "" },
    { rotulo: "Tipo", valor: (c) => c.participante?.tipo || "" },
    { rotulo: "E-mail", valor: (c) => c.participante?.email || "" },
    { rotulo: "Código", valor: (c) => c.participante?.codigo || "" },
    { rotulo: "Data", valor: (c) => formatarData(c.at) },
    { rotulo: "Hora", valor: (c) => hora(c.at) },
  ]);
  baixarCSV("checkins.csv", csv);
  toast("Arquivo gerado.", "ok");
}
