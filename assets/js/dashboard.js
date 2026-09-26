// =============================================================================
// Painel — agrega tudo no cliente (volume pequeno de dados).
// =============================================================================
import { iniciarPagina, dataPorExtenso, esc, formatarData } from "./ui.js";
import {
  listEstagios, listGrupos, listAnfitrioes, listConvidados, getEvento, listarEquipe,
} from "./supabase.js";
import { eventoId } from "./evento.js";
import { APP } from "./config.js";

const _iniciando = iniciarPagina("painel");

const el = (id) => document.getElementById(id);
let CTX = null;
let dados = null;
let filtroGrupo = "";
let faixaModo = "Confirmado";
let topAnfModo = "Confirmado";

el("data-hoje").textContent =
  dataPorExtenso().replace(/^\w/, (c) => c.toUpperCase());

_iniciando.then((ctx) => { if (ctx) { CTX = ctx; iniciar(); } });
async function iniciar() {
  try {
    const [estagios, grupos, membrosOrg, anfitrioes, convidados, evento] = await Promise.all([
      listEstagios(), listGrupos(),
      CTX?.org?.id ? listarEquipe(CTX.org.id).catch(() => []) : Promise.resolve([]),
      listAnfitrioes(), listConvidados(), getEvento(eventoId()),
    ]);
    dados = { estagios, grupos, membrosOrg, anfitrioes, convidados, evento };

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

    el("top-anf-toggle").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        el("top-anf-toggle").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
        b.classList.add("ativo");
        topAnfModo = b.dataset.topanf;
        renderTopAnfitrioes();
      };
    });

    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /evento_id|eventos|schema cache/.test(e.message || "")
      ? "Rode a migração <code>supabase/migrations/0005_eventos.sql</code> no SQL Editor do Supabase."
      : "Erro ao carregar: " + esc(e.message);
  }
}

/* -- filtros -- */
const anfNoGrupo = () =>
  dados.anfitrioes.filter((a) => !filtroGrupo || a.grupo_id === filtroGrupo);
const convNoGrupo = () =>
  dados.convidados.filter((c) => !filtroGrupo || c.anfitriao?.grupo_id === filtroGrupo);

function render() {
  renderFunilAnfitrioes();
  renderFunilConvidados();
  renderFaixas();
  renderAplicacoesDiarias();
  renderVisaoGrupos();
  renderTopAnfitrioes();
  renderTopResponsaveis();
  renderRecentes();
}

// Evolução diária de candidaturas: recebidas (todo mundo que se candidatou
// naquele dia) vs aprovadas (quem, daquele mesmo dia, está hoje com status
// Aprovado/Confirmado) — mais a meta diária necessária pra bater a meta de
// confirmados (mesma do Planejamento/meta-box do Funil de convidados) até a
// data do evento. Recalcula sozinha a cada dia: (meta − já aprovado) ÷ dias
// restantes. Não respeita o filtro de grupo: a meta é do evento inteiro.
const DIAS_JANELA_APLICACOES = 14;

function renderAplicacoesDiarias() {
  const todos = dados.convidados;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const eAprovado = (c) => c.status === "Aprovado" || c.status === "Confirmado";

  const chaveDia = (d) => d.toISOString().slice(0, 10);
  const recebidasPorDia = new Map();
  const aprovadasPorDia = new Map();
  todos.forEach((c) => {
    const d = new Date(c.created_at);
    d.setHours(0, 0, 0, 0);
    const k = chaveDia(d);
    recebidasPorDia.set(k, (recebidasPorDia.get(k) || 0) + 1);
    if (eAprovado(c)) aprovadasPorDia.set(k, (aprovadasPorDia.get(k) || 0) + 1);
  });

  const dias = [];
  for (let i = DIAS_JANELA_APLICACOES - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const k = chaveDia(d);
    dias.push({ data: d, recebidas: recebidasPorDia.get(k) || 0, aprovadas: aprovadasPorDia.get(k) || 0, hoje: i === 0 });
  }

  const recebidoTotal = todos.length;
  const aprovadoTotal = todos.filter(eAprovado).length;
  // mesma meta (e mesmo fallback) já usados no meta-box do Funil de convidados
  const metaPlanejamento = Number(dados.evento?.metas_planejamento?.convidados?.confirmados) || 0;
  const metaTotal = metaPlanejamento || dados.evento?.meta_confirmados || 0;
  const dataEventoStr = dados.evento?.data_evento;
  const faltam = Math.max(0, metaTotal - aprovadoTotal);
  let ritmo = null, diasRestantes = null;
  if (metaTotal > 0 && dataEventoStr) {
    const dataEvento = new Date(dataEventoStr + "T00:00:00");
    diasRestantes = Math.max(0, Math.round((dataEvento - hoje) / 86400000));
    ritmo = diasRestantes > 0 ? Math.ceil(faltam / diasRestantes) : faltam;
  }

  const ALTURA = 140;
  const maxValor = Math.max(1, ...dias.map((d) => d.recebidas), ritmo || 0);
  dias.forEach((d) => {
    d.recebidasPx = Math.max(2, Math.round((d.recebidas / maxValor) * ALTURA));
    d.aprovadasPx = Math.round((d.aprovadas / maxValor) * ALTURA);
  });
  const linhaRitmoPx = ritmo != null ? Math.min(ALTURA, Math.round((ritmo / maxValor) * ALTURA)) : null;

  const fmtCurto = (d) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
  const fmtLongo = (d) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

  // margem de 22px reservada no topo pro rótulo do ritmo não cortar quando a
  // linha tracejada cai bem no topo do gráfico (ritmo > qualquer dia da janela)
  el("aplic-grafico").innerHTML = `
    <div style="display:flex;gap:14px;margin-bottom:12px;font-size:.72rem;color:var(--texto-suave)">
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--cinza-300);margin-right:5px;vertical-align:middle"></span>Recebidas</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--cor-laranja-forte);margin-right:5px;vertical-align:middle"></span>Aprovadas</span>
    </div>
    <div style="position:relative;height:${ALTURA + 22}px;margin-bottom:6px">
      <div style="position:absolute;left:0;right:0;bottom:0;height:${ALTURA}px">
        ${linhaRitmoPx != null ? `
          <div style="position:absolute;left:0;right:0;bottom:${linhaRitmoPx}px;border-top:2px dashed var(--cor-laranja-forte);z-index:2">
            <span style="position:absolute;right:0;top:-17px;font-size:.68rem;color:var(--cor-laranja-forte);font-weight:700;white-space:nowrap;background:var(--superficie);padding-left:6px;border-radius:3px">Ritmo necessário: ${ritmo} aprovações/dia</span>
          </div>` : ""}
        <div style="display:flex;gap:5px;height:100%">
          ${dias.map((d) => `
            <div style="flex:1;position:relative;height:100%;border-radius:4px 4px 0 0;${d.hoje ? "background:var(--cor-laranja-suave)" : ""}" title="${fmtLongo(d.data)}: ${d.recebidas} recebida${d.recebidas === 1 ? "" : "s"}, ${d.aprovadas} aprovada${d.aprovadas === 1 ? "" : "s"}">
              ${d.recebidas > 0 ? `<span style="position:absolute;bottom:${d.recebidasPx + 4}px;left:50%;transform:translateX(-50%);font-size:.6rem;color:var(--texto-tenue);white-space:nowrap">${d.recebidas}</span>` : ""}
              <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:26px;max-width:80%;border-radius:4px 4px 0 0;background:var(--cinza-300);height:${d.recebidasPx}px"></div>
              <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:26px;max-width:80%;border-radius:4px 4px 0 0;background:var(--cor-laranja-forte);height:${d.aprovadasPx}px"></div>
            </div>`).join("")}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:5px">
      ${dias.map((d) => `<span style="flex:1;text-align:center;font-size:.62rem;color:var(--texto-tenue)">${fmtCurto(d.data)}</span>`).join("")}
    </div>`;

  el("aplic-legenda").textContent = !metaTotal
    ? `${recebidoTotal} recebidas · ${aprovadoTotal} aprovadas no total · defina a meta de confirmados em Planejamento para ver o ritmo necessário.`
    : !dataEventoStr
    ? `${recebidoTotal} recebidas · ${aprovadoTotal} de ${metaTotal} aprovadas · defina a data do evento em Configurações para ver o ritmo necessário.`
    : faltam === 0
    ? `Meta batida! ${aprovadoTotal} de ${metaTotal} aprovadas (${recebidoTotal} recebidas no total).`
    : `${recebidoTotal} recebidas · ${aprovadoTotal} de ${metaTotal} aprovadas · faltam ${faltam} em ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}.`;
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
  const total = c.length;
  const pend = cont("Pendente"), apr = cont("Aprovado") + cont("Confirmado"), conf = cont("Confirmado");
  let html = "";
  // Pendentes/Aprovados são categorias que se excluem (ninguém está nas
  // duas), então cada uma compara com o Total recebido, não uma com a
  // outra — só Confirmados é de fato um subconjunto de Aprovados.
  html += linhaFunil("Total recebido", total, null);
  html += linhaFunil("Pendentes", pend, total || null);
  html += linhaFunil("Aprovados", apr, total || null);
  html += linhaFunil("Confirmados", conf, apr || null);
  html += `<div class="funil-linha" style="margin-top:6px">
      <div class="nome">Recusados</div>
      <div class="trilha"><div class="preenche" style="width:0"></div></div>
      <div class="qtd">${cont("Recusado")}</div></div>`;
  el("funil-convidados").innerHTML = html;

  // Meta vem do Planejamento (grupo "Convidados") — mesmo número usado lá.
  // Cai pro campo antigo de Configurações só se o Planejamento não tiver
  // meta definida ainda.
  const metaPlanejamento = Number(dados.evento?.metas_planejamento?.convidados?.confirmados) || 0;
  const meta = metaPlanejamento || dados.evento?.meta_confirmados || 0;
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
    el("meta-box").innerHTML = `<p class="pagina-sub" style="margin:0">Defina a meta em Planejamento.</p>`;
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
  const campo = topAnfModo === "Aprovado" ? "aprovados" : "confirmados";
  const rotulo = topAnfModo === "Aprovado" ? "aprovados" : "confirmados";
  const top = anfNoGrupo()
    .filter((a) => (a[campo] || 0) > 0)
    .sort((a, b) => (b[campo] || 0) - (a[campo] || 0))
    .slice(0, 10);
  el("top-anfitrioes").innerHTML = top.length
    ? top.map((a, i) => rankLinha(i + 1, a.nome, `${a[campo]} ${rotulo}`)).join("")
    : `<p class="pagina-sub" style="margin:0">Ninguém com ${rotulo} ainda.</p>`;
}

function renderTopResponsaveis() {
  const mapa = new Map();
  anfNoGrupo().forEach((a) => {
    if (!a.responsavel_user_id) return;
    const cur = mapa.get(a.responsavel_user_id) || { enviados: 0, confirmados: 0 };
    cur.enviados += a.enviados || 0;
    cur.confirmados += a.confirmados || 0;
    mapa.set(a.responsavel_user_id, cur);
  });
  const nome = (id) => {
    const m = dados.membrosOrg.find((x) => x.user_id === id);
    return m ? (m.nome || m.email) : "—";
  };
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
