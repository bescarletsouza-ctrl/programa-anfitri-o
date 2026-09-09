// =============================================================================
// Painel — agrega tudo no cliente (volume pequeno de dados).
// =============================================================================
import { iniciarPagina, dataPorExtenso, esc, formatarData } from "./ui.js";
import {
  listEstagios, listGrupos, listResponsaveis, listAnfitrioes, listConvidados, getConfig,
} from "./supabase.js";
import { APP } from "./config.js";

iniciarPagina("painel");

const el = (id) => document.getElementById(id);
let dados = null;
let filtroGrupo = "";
let faixaModo = "Confirmado";

el("data-hoje").textContent =
  dataPorExtenso().replace(/^\w/, (c) => c.toUpperCase());

(async function () {
  try {
    const [estagios, grupos, responsaveis, anfitrioes, convidados, config] = await Promise.all([
      listEstagios(), listGrupos(), listResponsaveis(), listAnfitrioes(), listConvidados(), getConfig(),
    ]);
    dados = { estagios, grupos, responsaveis, anfitrioes, convidados, config };

    const fg = el("filtro-grupo");
    grupos.forEach((g) => fg.add(new Option(g.nome, g.id)));
    fg.onchange = () => { filtroGrupo = fg.value; render(); };

    el("fx-toggle").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        el("fx-toggle").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
        b.classList.add("ativo");
        faixaModo = b.dataset.fx;
        renderFaixas();
      };
    });

    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").textContent = "Erro ao carregar: " + e.message;
  }
})();

/* -- filtros -- */
const anfNoGrupo = () =>
  dados.anfitrioes.filter((a) => !filtroGrupo || a.grupo_id === filtroGrupo);
const convNoGrupo = () =>
  dados.convidados.filter((c) => !filtroGrupo || c.anfitriao?.grupo_id === filtroGrupo);

function render() {
  renderFunilAnfitrioes();
  renderFunilConvidados();
  renderFaixas();
  renderVisaoGrupos();
  renderTopAnfitrioes();
  renderTopResponsaveis();
  renderRecentes();
}

function linhaFunil(nome, qtd, anterior) {
  const max = Math.max(qtd, anterior || qtd, 1);
  const pct = (qtd / max) * 100;
  const queda =
    anterior != null && anterior > 0
      ? `<div class="funil-queda">↓ ${Math.round((qtd / anterior) * 100)}%</div>`
      : "";
  return `${queda}
    <div class="funil-linha">
      <div class="nome">${esc(nome)}</div>
      <div class="trilha"><div class="preenche" style="width:${pct}%"></div></div>
      <div class="qtd">${qtd}</div>
    </div>`;
}

function renderFunilAnfitrioes() {
  const base = anfNoGrupo().filter((a) => a.vai !== false);
  let html = "", anterior = null;
  dados.estagios.forEach((s) => {
    const qtd = base.filter((a) => a.estagio_id === s.id).length;
    html += linhaFunil(s.nome, qtd, anterior);
    anterior = qtd;
  });
  const semEstagio = base.filter((a) => !a.estagio_id).length;
  if (semEstagio) html = linhaFunil("Sem estágio", semEstagio, null) + html;
  el("funil-anfitrioes").innerHTML = html || `<p class="pagina-sub">Sem anfitriões.</p>`;
}

function renderFunilConvidados() {
  const c = convNoGrupo();
  const cont = (s) => c.filter((x) => x.status === s).length;
  const pend = cont("Pendente"), apr = cont("Aprovado") + cont("Confirmado"), conf = cont("Confirmado");
  let html = "";
  html += linhaFunil("Pendentes", pend, null);
  html += linhaFunil("Aprovados", apr, pend || null);
  html += linhaFunil("Confirmados", conf, apr || null);
  html += `<div class="funil-linha" style="margin-top:6px">
      <div class="nome">Recusados</div>
      <div class="trilha"><div class="preenche" style="width:0"></div></div>
      <div class="qtd">${cont("Recusado")}</div></div>`;
  el("funil-convidados").innerHTML = html;

  const meta = dados.config?.meta_confirmados || 0;
  if (meta > 0) {
    const pct = Math.min(100, Math.round((conf / meta) * 100));
    el("meta-box").innerHTML = `
      <div class="funil-queda" style="grid-column:auto;text-align:left;margin:0 0 4px">META DE CONFIRMADOS</div>
      <div class="funil-linha">
        <div class="nome">${conf} / ${meta}</div>
        <div class="trilha"><div class="preenche" style="width:${pct}%;background:var(--ok)"></div></div>
        <div class="qtd">${pct}%</div>
      </div>`;
  } else {
    el("meta-box").innerHTML = `<p class="pagina-sub" style="margin:0">Defina a meta em Configurações.</p>`;
  }
}

function renderFaixas() {
  if (!dados) return;
  let base = convNoGrupo();
  if (faixaModo === "Confirmado") base = base.filter((c) => c.status === "Confirmado");
  else if (faixaModo === "Aprovado") base = base.filter((c) => c.status === "Aprovado" || c.status === "Confirmado");
  const total = base.length;
  const mapa = new Map();
  base.forEach((c) => {
    const k = c.faturamento || "Não informado";
    mapa.set(k, (mapa.get(k) || 0) + 1);
  });
  const linhas = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  el("faixas").innerHTML =
    total === 0
      ? `<p class="pagina-sub" style="margin:0">Nenhum convidado nesta seleção.</p>`
      : `<p class="pagina-sub" style="margin:0 0 10px">Total: ${total}</p>` +
        linhas
          .map(([nome, q]) => {
            const pct = Math.round((q / total) * 100);
            return `<div class="funil-linha">
              <div class="nome">${esc(nome)}</div>
              <div class="trilha"><div class="preenche" style="width:${pct}%"></div></div>
              <div class="qtd">${q} <span style="color:var(--texto-suave);font-size:.75rem">${pct}%</span></div>
            </div>`;
          })
          .join("");
}

function renderVisaoGrupos() {
  const wrap = el("visao-grupos");
  const grupos = filtroGrupo ? dados.grupos.filter((g) => g.id === filtroGrupo) : dados.grupos;
  if (!grupos.length) { wrap.innerHTML = `<p class="pagina-sub">Nenhum grupo cadastrado.</p>`; return; }
  wrap.innerHTML = grupos
    .map((g) => {
      const anf = dados.anfitrioes.filter((a) => a.grupo_id === g.id);
      const enviados = anf.reduce((s, a) => s + (a.enviados || 0), 0);
      const conf = anf.reduce((s, a) => s + (a.confirmados || 0), 0);
      return `<div class="card" style="box-shadow:none">
        <div class="badge badge-laranja" style="margin-bottom:10px">${esc(g.nome)}</div>
        <div class="grid grid-3">
          <div class="kpi"><span class="valor">${anf.length}</span><span class="rotulo">Anfitriões</span></div>
          <div class="kpi"><span class="valor">${enviados}</span><span class="rotulo">Enviados</span></div>
          <div class="kpi"><span class="valor">${conf}</span><span class="rotulo">Confirmados</span></div>
        </div></div>`;
    })
    .join("");
}

function renderTopAnfitrioes() {
  const top = anfNoGrupo()
    .filter((a) => (a.confirmados || 0) > 0)
    .sort((a, b) => (b.confirmados || 0) - (a.confirmados || 0))
    .slice(0, 10);
  el("top-anfitrioes").innerHTML = top.length
    ? top.map((a, i) => rankLinha(i + 1, a.nome, `${a.confirmados} confirmados`)).join("")
    : `<p class="pagina-sub" style="margin:0">Ninguém com confirmados ainda.</p>`;
}

function renderTopResponsaveis() {
  const mapa = new Map();
  anfNoGrupo().forEach((a) => {
    if (!a.responsavel_id) return;
    const cur = mapa.get(a.responsavel_id) || { enviados: 0, confirmados: 0 };
    cur.enviados += a.enviados || 0;
    cur.confirmados += a.confirmados || 0;
    mapa.set(a.responsavel_id, cur);
  });
  const nome = (id) => dados.responsaveis.find((r) => r.id === id)?.nome || "—";
  const linhas = [...mapa.entries()]
    .sort((a, b) => b[1].confirmados - a[1].confirmados)
    .slice(0, 10);
  el("top-responsaveis").innerHTML = linhas.length
    ? linhas.map(([id, v], i) => rankLinha(i + 1, nome(id), `${v.enviados} enviados · ${v.confirmados} confirmados`)).join("")
    : `<p class="pagina-sub" style="margin:0">Sem responsáveis com atividade.</p>`;
}

function rankLinha(pos, nome, detalhe) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--cinza-100)">
    <span class="badge badge-neutro" style="min-width:28px;justify-content:center">${pos}</span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:.9rem">${esc(nome)}</div>
      <div class="pagina-sub" style="margin:0;font-size:.78rem">${esc(detalhe)}</div>
    </div>
  </div>`;
}

function renderRecentes() {
  const c = convNoGrupo().slice(0, 5);
  el("recentes").innerHTML = c.length
    ? c
        .map(
          (x) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--cinza-100)">
        <div><div style="font-weight:600;font-size:.9rem">${esc(x.nome || "—")}</div>
          <div class="pagina-sub" style="margin:0;font-size:.78rem">convidado por ${esc(x.anfitriao?.nome || "—")}</div></div>
        <div style="text-align:right"><span class="badge ${badgeStatus(x.status)}">${esc(x.status)}</span>
          <div class="pagina-sub" style="margin:2px 0 0;font-size:.72rem">${formatarData(x.created_at)}</div></div>
      </div>`
        )
        .join("")
    : `<p class="pagina-sub" style="margin:0">Nenhum convidado ainda.</p>`;
}

export function badgeStatus(s) {
  return {
    Pendente: "badge-alerta",
    Aprovado: "badge-info",
    Recusado: "badge-erro",
    Confirmado: "badge-ok",
  }[s] || "badge-neutro";
}
