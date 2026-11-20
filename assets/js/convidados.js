// =============================================================================
// Gestão de convidados — tabela, filtros, pills, gaveta de decisão.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, telParaWhatsApp,
  abrirModal, abrirGaveta, fecharGaveta, toast, confirmar, icone, souAgente,
} from "./ui.js";
import {
  listGrupos, listAnfitrioes, listConvidados, listFormPerguntas, salvar, remover,
  sincParticipanteConvidado, listObservacoesDoTipo,
} from "./supabase.js";
import { baixarXLSX } from "./tabela.js";
import { STATUS_CONVIDADO } from "./config.js";
import { multiSelects, valoresDe, casa } from "./multiselect.js";
import { montarObservacoes } from "./observacoes.js";

const _iniciando = iniciarPagina("convidados");
const el = (id) => document.getElementById(id);

let grupos = [], anfitrioes = [], lista = [], perguntas = [];
const filtros = { busca: "", status: [], grupo: [] };   // status e grupo aceitam vários valores
const selecionados = new Set();
let aba = "todos";

// aplica a decisão do convidado (status) + sincroniza a lista de Participantes
async function decidir(c, status) {
  await salvar("convidados", { id: c.id, status });
  await sincParticipanteConvidado({ ...c, status }).catch((e) => console.warn(e));
}

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });

async function carregar() {
  try {
    [grupos, anfitrioes, lista, perguntas] = await Promise.all([
      listGrupos(), listAnfitrioes(), listConvidados(), listFormPerguntas(),
    ]);
    el("f-status").innerHTML = `<option value="">Todos os status</option>` +
      STATUS_CONVIDADO.map((s) => `<option>${s}</option>`).join("");
    el("f-grupo").innerHTML = `<option value="">Todos os grupos</option>` +
      grupos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join("");
    el("carregando").hidden = true;
    render();
  } catch (e) {
    el("carregando").innerHTML = /categoria_convidado|convidado_id|schema cache/.test(e.message || "")
      ? "Rode a migração <code>supabase/migrations/0008_convidado_participante.sql</code> no SQL Editor do Supabase."
      : "Erro ao carregar: " + esc(e.message);
  }
}

el("busca").addEventListener("input", debounce((e) => { filtros.busca = e.target.value.toLowerCase(); render(); }, 200));
multiSelects(["f-status", "f-grupo"]);
el("f-status").addEventListener("change", (e) => { filtros.status = valoresDe(e.target); render(); });
el("f-grupo").addEventListener("change", (e) => { filtros.grupo = valoresDe(e.target); render(); });
el("btn-novo").innerHTML = icone("mais") + "Novo convidado";
el("btn-novo").onclick = modalNovo;
el("btn-exportar").innerHTML = icone("baixar") + "Exportar Excel";
el("btn-exportar").onclick = exportarConvidados;

el("btn-toggle-filtros").onclick = () => {
  const painel = el("filtros-painel");
  painel.hidden = !painel.hidden;
  el("btn-toggle-filtros").setAttribute("aria-expanded", String(!painel.hidden));
};
el("btn-limpar-filtros").onclick = () => {
  Object.assign(filtros, { busca: "", status: [], grupo: [] });
  el("busca").value = ""; el("f-status").value = ""; el("f-grupo").value = "";
  render();
};
el("abas").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    el("abas").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
    b.classList.add("ativo");
    aba = b.dataset.aba;
    render();
  };
});

const badgeStatus = (s) =>
  ({ Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro");
// Situação do participante gerado a partir do convite — campo separado do
// status do convite acima (Pendente/Aprovado/Recusado/Confirmado).
const badgeSituacao = (s) =>
  ({ Confirmado: "badge-ok", Pendente: "badge-alerta", "Fila de espera": "badge-info",
     "Pré-inscrito": "badge-neutro", Desativado: "badge-erro" }[s] || "badge-neutro");
const situacaoDoParticipante = (c) =>
  (Array.isArray(c.participante) ? c.participante[0]?.situacao : c.participante?.situacao) || null;

const filtrosAtivos = () => !!(filtros.busca || filtros.status.length || filtros.grupo.length);

function filtrar() {
  return lista.filter((c) => {
    if (aba === "pendentes" && c.status !== "Pendente") return false;
    if (aba === "analisados" && c.status === "Pendente") return false;
    if (!casa(filtros.status, c.status)) return false;
    if (!casa(filtros.grupo, c.anfitriao?.grupo_id)) return false;
    if (filtros.busca) {
      const alvo = `${c.nome || ""} ${c.email || ""} ${c.empresa || ""}`.toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

function render() {
  const filtrada = filtrar();
  el("btn-toggle-filtros").classList.toggle("ativo", filtrosAtivos());

  const cont = (s) => lista.filter((c) => c.status === s).length;
  el("pills").innerHTML = STATUS_CONVIDADO.map(
    (s) => `<div class="card" style="box-shadow:none;padding:14px">
      <div class="kpi"><span class="valor">${cont(s)}</span>
      <span class="rotulo"><span class="badge ${badgeStatus(s)}">${s}</span></span></div></div>`
  ).join("");

  const vazio = filtrada.length === 0;
  el("wrap").hidden = vazio;
  el("vazio").hidden = !vazio;

  [...selecionados].forEach((id) => { if (!filtrada.some((c) => c.id === id)) selecionados.delete(id); });
  sincronizarBarra(filtrada);
  if (vazio) return;

  el("linhas").innerHTML = filtrada
    .map((c) => {
      const wa = telParaWhatsApp(c.telefone);
      const marcado = selecionados.has(c.id);
      return `<tr data-id="${c.id}" class="${marcado ? "sel" : ""}">
        <td class="col-check"><input type="checkbox" data-sel ${marcado ? "checked" : ""} aria-label="Selecionar ${esc(c.nome || "")}" /></td>
        <td><strong>${esc(c.nome || "—")}</strong><div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(c.email || "")}</div></td>
        <td>${esc(c.empresa || "—")}</td>
        <td>${esc(c.anfitriao?.nome || "—")}</td>
        <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(c.telefone)}</a>` : "—"}</td>
        <td><span class="badge ${badgeStatus(c.status)}">${esc(c.status)}</span></td>
        <td>${situacaoDoParticipante(c) ? `<span class="badge ${badgeSituacao(situacaoDoParticipante(c))}">${esc(situacaoDoParticipante(c))}</span>` : `<span class="cel-tenue">—</span>`}</td>
        <td>${formatarData(c.created_at)}</td>
        <td class="linha-acoes">
          <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
          <button class="icone-btn so-admin" data-excluir title="Excluir">${icone("excluir")}</button>
        </td>
      </tr>`;
    })
    .join("");
  el("linhas").querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector("[data-sel]").onclick = (e) => {
      e.stopPropagation();
      e.target.checked ? selecionados.add(id) : selecionados.delete(id);
      tr.classList.toggle("sel", e.target.checked);
      sincronizarBarra(filtrar());
    };
    tr.querySelector("[data-editar]").onclick = (e) => { e.stopPropagation(); modalEditar(lista.find((x) => x.id === id)); };
    tr.querySelector("[data-excluir]").onclick = (e) => { e.stopPropagation(); excluirConvidado(lista.find((x) => x.id === id)); };
    tr.onclick = () => abrirGavetaDetalhe(id);
  });
}

function sincronizarBarra(filtrada) {
  const n = selecionados.size;
  el("barra-acoes").hidden = n === 0;
  el("sel-cont").textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
  const todos = el("check-todos");
  const noFiltro = filtrada.filter((c) => selecionados.has(c.id)).length;
  todos.checked = filtrada.length > 0 && noFiltro === filtrada.length;
  todos.indeterminate = noFiltro > 0 && noFiltro < filtrada.length;
}

el("check-todos").onchange = (e) => {
  const filtrada = filtrar();
  if (e.target.checked) filtrada.forEach((c) => selecionados.add(c.id));
  else filtrada.forEach((c) => selecionados.delete(c.id));
  render();
};
el("barra-acoes").querySelectorAll("[data-acao]").forEach((b) => {
  b.onclick = () => acaoEmMassa(b.dataset.acao);
});

async function acaoEmMassa(acao) {
  if (acao === "limpar") { selecionados.clear(); render(); return; }
  const alvo = lista.filter((c) => selecionados.has(c.id));
  if (!alvo.length) return;
  const status = acao === "aprovar" ? "Aprovado" : "Recusado";
  if (!confirmar(`${acao === "aprovar" ? "Aprovar" : "Reprovar"} ${alvo.length} convidado(s)?`)) return;
  try {
    for (const c of alvo) await decidir(c, status);
    selecionados.clear();
    toast(`${alvo.length} convidado(s) ${acao === "aprovar" ? "aprovado(s)" : "reprovado(s)"}.`, "ok");
    lista = await listConvidados();
    render();
  } catch (e) { toast(e.message, "erro"); }
}

/* ---- Exportar ---- */
// Exporta o que está na tela (ou só os selecionados): tudo que o painel mostra — contato, empresa,
// anfitrião, categoria liberada, status, situação, data, observações — mais CADA resposta do formulário.
async function exportarConvidados() {
  const linhas = selecionados.size ? lista.filter((c) => selecionados.has(c.id)) : filtrar();
  if (!linhas.length) { toast("Nada para exportar.", "erro"); return; }
  const btn = el("btn-exportar");
  btn.disabled = true;
  try {
    const obs = await listObservacoesDoTipo("convidado").catch(() => []);
    const obsPorConvidado = new Map();
    obs.forEach((o) => {
      const l = obsPorConvidado.get(o.registro_id) || [];
      l.push(`${o.autor_nome || "—"} (${formatarData(o.created_at, true)}): ${o.texto}`);
      obsPorConvidado.set(o.registro_id, l);
    });

    const rotuloDe = (chave, padrao) => perguntas.find((p) => p.chave === chave)?.rotulo || padrao;
    const texto = (v) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

    const colunas = [
      { rotulo: "Nome", valor: (c) => c.nome || "" },
      { rotulo: "E-mail", valor: (c) => c.email || "" },
      { rotulo: "Telefone", valor: (c) => c.telefone || "" },
      { rotulo: "Convidado por", valor: (c) => c.anfitriao?.nome || "" },
      { rotulo: "Tipo do anfitrião", valor: (c) => grupos.find((g) => g.id === c.anfitriao?.grupo_id)?.nome || "" },
      { rotulo: "Categoria liberada", valor: (c) => c.anfitriao?.categoria_convidado || "" },
      { rotulo: "Status do convite", valor: (c) => c.status || "" },
      { rotulo: "Situação do participante", valor: (c) => situacaoDoParticipante(c) || "" },
      { rotulo: "Recebido em", valor: (c) => formatarData(c.created_at, true) },
      // campos de sistema (colunas próprias), com o rótulo da pergunta de verdade deste evento
      ...CAMPOS_SISTEMA.map((cs) => ({
        rotulo: rotuloDe(cs.chave, { empresa: "Empresa", cnpj: "CNPJ", faturamento: "Faturamento mensal", funcionarios: "Nº de funcionários", site: "Site" }[cs.chave]),
        valor: (c) => texto(c[cs.coluna]),
      })),
    ];
    // respostas das perguntas personalizadas, na ordem do formulário
    perguntas.filter((p) => !p.sistema).forEach((p) =>
      colunas.push({ rotulo: p.rotulo || p.chave, valor: (c) => texto(c.respostas?.[p.chave]) }));
    // respostas de perguntas que já não existem mais no formulário (não perde nada)
    const conhecidas = new Set(perguntas.map((p) => p.chave));
    const orfas = [...new Set(linhas.flatMap((c) => Object.keys(c.respostas || {})))].filter((k) => !conhecidas.has(k));
    orfas.forEach((k) => colunas.push({ rotulo: k, valor: (c) => texto(c.respostas?.[k]) }));
    colunas.push({ rotulo: "Observações", valor: (c) => (obsPorConvidado.get(c.id) || []).join("\n") });

    // rótulos repetidos (ex.: pergunta "Empresa" e coluna de sistema) ganham sufixo pra não se sobrescreverem
    const usados = new Map();
    colunas.forEach((col) => {
      const n = (usados.get(col.rotulo) || 0) + 1;
      usados.set(col.rotulo, n);
      if (n > 1) col.rotulo = `${col.rotulo} (${n})`;
    });

    await baixarXLSX("convidados.xlsx", linhas, colunas);
    toast(`${linhas.length} convidado${linhas.length === 1 ? "" : "s"} exportado${linhas.length === 1 ? "" : "s"}.`, "ok");
  } catch (e) {
    toast(e.message || "Não foi possível exportar.", "erro");
  } finally {
    btn.disabled = false;
  }
}

/* ---- Novo convidado (manual) ---- */
function modalNovo() {
  if (!anfitrioes.length) {
    toast("Cadastre um anfitrião antes.", "erro");
    return;
  }
  abrirModal({
    titulo: "Novo convidado",
    textoConfirmar: "Criar",
    corpoHtml: `
      <label class="campo"><span>Anfitrião *</span>
        <select class="select" name="anfitriao_id" required>
          ${anfitrioes.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" /></label>
      <label class="campo"><span>Empresa</span><input class="input" name="empresa" /></label>
      <label class="campo"><span>CNPJ</span><input class="input" name="cnpj" /></label>
      <label class="campo"><span>Site</span><input class="input" name="site" /></label>
      ${campoSelecao("faturamento", "Faturamento mensal")}
      ${campoSelecao("funcionarios", "Nº de funcionários")}`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      Object.keys(f).forEach((k) => { if (f[k] === "") f[k] = null; });
      await salvar("convidados", { ...f, status: "Pendente" });
      toast("Convidado criado.", "ok");
      lista = await listConvidados();
      render();
    },
  });
}

/* ---- Editar convidado ---- */
function modalEditar(c) {
  if (!c) return;
  abrirModal({
    titulo: "Editar convidado",
    textoConfirmar: "Salvar",
    corpoHtml: `
      <label class="campo"><span>Anfitrião *</span>
        <select class="select" name="anfitriao_id" required>
          ${anfitrioes.map((a) => `<option value="${a.id}" ${a.id === c.anfitriao_id ? "selected" : ""}>${esc(a.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required value="${esc(c.nome || "")}" /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" value="${esc(c.email || "")}" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" value="${esc(c.telefone || "")}" /></label>
      <label class="campo"><span>Empresa</span><input class="input" name="empresa" value="${esc(c.empresa || "")}" /></label>
      <label class="campo"><span>CNPJ</span><input class="input" name="cnpj" value="${esc(c.cnpj || "")}" /></label>
      <label class="campo"><span>Site</span><input class="input" name="site" value="${esc(c.site || "")}" /></label>
      ${campoSelecao("faturamento", "Faturamento mensal", c.faturamento)}
      ${campoSelecao("funcionarios", "Nº de funcionários", c.funcionarios)}`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      Object.keys(f).forEach((k) => { if (f[k] === "") f[k] = null; });
      await salvar("convidados", { id: c.id, ...f });
      toast("Convidado atualizado.", "ok");
      lista = await listConvidados();
      render();
    },
  });
}

async function excluirConvidado(c) {
  if (!c) return;
  if (!confirmar(`Excluir "${c.nome}"?`)) return;
  try {
    await remover("convidados", c.id);
    toast("Convidado excluído.", "ok");
    fecharGaveta();
    lista = await listConvidados();
    render();
  } catch (e) {
    toast(e.message, "erro");
  }
}

// Campos "de sistema" do formulário — ficam em colunas próprias de
// "convidados" (não em respostas), mas o rótulo exibido tem que ser o da
// pergunta de verdade cadastrada pro evento, não um texto fixo — cada evento
// pode usar esse campo pra perguntar algo diferente (ex.: "cnpj" virar
// "Você é sócio, funcionário ou fundador?" em vez de "CNPJ").
const CAMPOS_SISTEMA = [
  { chave: "empresa", coluna: "empresa" },
  { chave: "cnpj", coluna: "cnpj" },
  { chave: "faturamento", coluna: "faturamento" },
  { chave: "funcionarios", coluna: "funcionarios" },
  { chave: "site", coluna: "site" },
];

function campoSelecao(chave, rotulo, valorAtual) {
  const p = perguntas.find((x) => x.chave === chave);
  const opts = (p?.opcoes || []).map((o) => `<option ${o === valorAtual ? "selected" : ""}>${esc(o)}</option>`).join("");
  return `<label class="campo"><span>${esc(rotulo)}</span>
    <select class="select" name="${chave}"><option value="">—</option>${opts}</select></label>`;
}

/* ---- Gaveta de detalhe ---- */
function abrirGavetaDetalhe(id) {
  const c = lista.find((x) => x.id === id);
  if (!c) return;
  const extras = perguntas.filter((p) => !p.sistema && c.respostas && c.respostas[p.chave] != null);
  // só mostra os campos de sistema que este evento realmente usa no
  // formulário, com o rótulo da pergunta de verdade (não um texto fixo)
  const camposEmpresa = CAMPOS_SISTEMA
    .map((cs) => ({ ...cs, pergunta: perguntas.find((p) => p.chave === cs.chave) }))
    .filter((cs) => cs.pergunta);

  abrirGaveta(
    `${esc(c.nome || "Convidado")}`,
    `
    <div class="secao">
      <h4>Decisão</h4>
      <div class="so-admin" style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-primario" id="d-aprovar" style="flex:1;background:var(--ok-solid);border-color:var(--ok-solid)"
          ${c.status === "Aprovado" || c.status === "Confirmado" ? "disabled" : ""}>${icone("check")} Aprovar</button>
        <button class="btn btn-perigo" id="d-reprovar" style="flex:1"
          ${c.status === "Recusado" ? "disabled" : ""}>${icone("x")} Reprovar</button>
      </div>
      <select class="select so-admin" id="d-status">
        ${STATUS_CONVIDADO.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <p class="pagina-sub" style="margin:6px 0 0;font-size:.72rem">
        Status atual: <b>${esc(c.status)}</b> — o convidado vê isso na página de acompanhamento.
      </p>
      ${souAgente() ? `<p class="pagina-sub" style="margin:6px 0 0;font-size:.72rem">Só um administrador aprova ou recusa convidados.</p>` : ""}
      <p class="pagina-sub so-admin" style="margin:6px 0 0;font-size:.72rem">
        Ao aprovar, entra na lista de Participantes${
          c.anfitriao?.categoria_convidado
            ? ` na categoria <b>${esc(c.anfitriao.categoria_convidado)}</b>`
            : " (defina a categoria no cadastro do anfitrião)"
        }. Reprovar remove da lista.
      </p>
      ${situacaoDoParticipante(c) ? `<p class="pagina-sub" style="margin:6px 0 0;font-size:.72rem">
        Situação do participante: <span class="badge ${badgeSituacao(situacaoDoParticipante(c))}">${esc(situacaoDoParticipante(c))}</span>
        — campo separado, editável em Participantes.
      </p>` : ""}
    </div>

    <div class="secao">
      <h4>Contato</h4>
      <p style="margin:4px 0">${esc(c.email || "—")}</p>
      <p style="margin:4px 0">${
        telParaWhatsApp(c.telefone)
          ? `<a href="${telParaWhatsApp(c.telefone)}" target="_blank" rel="noopener">${esc(c.telefone)}</a>`
          : "—"
      }</p>
      <p style="margin:4px 0" class="pagina-sub">Convidado por ${esc(c.anfitriao?.nome || "—")}</p>
    </div>

    ${
      camposEmpresa.length
        ? `<div class="secao"><h4>Empresa</h4>${camposEmpresa
            .map((cs) => infoLinha(cs.pergunta.rotulo, c[cs.coluna]))
            .join("")}</div>`
        : ""
    }

    ${
      extras.length
        ? `<div class="secao"><h4>Outras respostas</h4>${extras
            .map((p) => infoLinha(p.rotulo, c.respostas[p.chave]))
            .join("")}</div>`
        : ""
    }

    <div class="secao">
      <h4>Observações internas</h4>
      <div id="d-obs-box"></div>
    </div>

    <div class="secao">
      <p class="pagina-sub" style="margin:0;font-size:.75rem">Recebido em ${formatarData(c.created_at, true)}</p>
    </div>

    <div class="secao zona-perigo so-admin">
      <p>Use apenas para registros de teste.</p>
      <button class="btn btn-perigo" id="d-excluir">Excluir convidado</button>
    </div>`
  );

  const g = document.getElementById("gaveta");
  const salvarConvidado = async (patch, msg) => {
    try {
      await salvar("convidados", { id: c.id, ...patch });
      if (patch.status) await sincParticipanteConvidado({ ...c, status: patch.status }).catch((e) => console.warn(e));
      toast(msg, "ok");
      lista = await listConvidados();
      render();
    } catch (e) {
      toast(e.message, "erro");
    }
  };
  g.querySelector("#d-status").onchange = (e) =>
    salvarConvidado({ status: e.target.value }, "Status atualizado.");
  g.querySelector("#d-aprovar").onclick = () =>
    salvarConvidado({ status: "Aprovado" }, "Convidado aprovado.").then(fecharGaveta);
  g.querySelector("#d-reprovar").onclick = () =>
    salvarConvidado({ status: "Recusado" }, "Convidado reprovado.").then(fecharGaveta);
  montarObservacoes(g.querySelector("#d-obs-box"), { tipo: "convidado", id: c.id, tabela: "convidados", legado: c.observacao });
  g.querySelector("#d-excluir").onclick = () => excluirConvidado(c);
}

function infoLinha(rotulo, valor) {
  return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--cinza-100)">
    <span class="pagina-sub" style="margin:0">${esc(rotulo)}</span>
    <span style="font-size:.88rem;text-align:right">${esc(valor || "—")}</span></div>`;
}
