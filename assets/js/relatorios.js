// =============================================================================
// Relatórios de credenciamento — KPIs, presença por ingresso/tipo, check-ins
// por hora e lista dos últimos check-ins. Tudo client-side, sem lib de gráfico.
// =============================================================================
import { iniciarPagina, esc, debounce, formatarData, toast } from "./ui.js";
import { listParticipantes, listCheckins, listAtividades } from "./supabase.js";
import { gerarCSV, baixarCSV } from "./tabela.js";

iniciarPagina("relatorios");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let atividades = [];
let buscaLog = "";

carregar();
el("btn-atualizar").onclick = () => carregar();
el("btn-exportar").onclick = exportar;
el("busca-log").addEventListener("input", debounce((e) => { buscaLog = e.target.value.trim().toLowerCase(); renderLog(); }, 200));
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    [participantes, checkins, atividades] = await Promise.all([
      listParticipantes(), listCheckins(), listAtividades().catch(() => []),
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
const nomeAtividade = (id) => (id && atividades.find((a) => a.id === id)?.nome) || "Evento";

function render() {
  renderKpis();
  renderDias();
  renderHoras();
  renderQuebra("rel-ingresso", (p) => p.ingresso || "Sem categoria");
  renderQuebra("rel-tipo", (p) => p.tipo || "—");
  renderAtividades();
  renderLog();
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

  const kpi = (valor, rotulo) => `<div class="card"><div class="kpi"><span class="valor">${valor}</span><span class="rotulo">${esc(rotulo)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(total, "Participantes") +
    kpi(presentes, "Presentes agora") +
    kpi(hoje, "Check-ins hoje") +
    kpi(ultimaHora, "Na última hora") +
    kpi(taxa + "%", "Taxa de presença");
}

function renderDias() {
  const entradas = checkins.filter((c) => c.acao === "entrada");
  if (!entradas.length) {
    el("rel-dias").innerHTML = `<p class="pagina-sub" style="margin:auto">Nenhum check-in registrado ainda.</p>`;
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
    .map(({ d, n }) => `<div class="rel-hora" title="${n} check-in(s) em ${formatarData(d.toISOString())}">
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
        <td>${esc(nomeAtividade(c.atividade_id))}</td>
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
    { rotulo: "Atividade", valor: (c) => nomeAtividade(c.atividade_id) },
    { rotulo: "E-mail", valor: (c) => c.participante?.email || "" },
    { rotulo: "Código", valor: (c) => c.participante?.codigo || "" },
    { rotulo: "Data", valor: (c) => formatarData(c.at) },
    { rotulo: "Hora", valor: (c) => hora(c.at) },
  ]);
  baixarCSV("checkins.csv", csv);
  toast("Arquivo gerado.", "ok");
}
