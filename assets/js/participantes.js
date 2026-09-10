// =============================================================================
// Participantes do evento — visão Lista (tabela) e visão Pipeline (kanban).
// Lista manual. tipo "Anfitrião" também cria/vincula um registro em anfitrioes.
// Lista: edição inline (Tipo/Pagamento/Etapa), seleção múltipla + ações em
// massa, filtro de presença, paginação e crachá pela gaveta.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, abrirModal, abrirGaveta,
  fecharGaveta, toast, confirmar, icone, abrirMenu,
} from "./ui.js";
import {
  listParticipantes, listEtapasParticipante, listAtividades, listCheckins, listTiposIngresso,
  salvar, remover, inserirLote, atualizarEmLote, removerEmLote, registrarCheckin,
  sincParticipanteAnfitriao, desvincularAoExcluirParticipante,
} from "./supabase.js";
import { eventoNome } from "./evento.js";
import { imprimirCracha } from "./cracha.js";
import { parsearTabela, gerarCSV, baixarCSV } from "./tabela.js";
import { abrirEnvioEmail } from "./email.js";

iniciarPagina("participantes");
const el = (id) => document.getElementById(id);

const TIPOS = ["Convidado", "Anfitrião", "Acompanhante", "Comprador", "Cliente", "Outro"];
const PAGAMENTOS = ["Gratuito", "Pago", "Convidado", "Cancelado", "Reembolsado"];
const SITUACOES = ["Confirmado", "Pendente", "Fila de espera", "Pré-inscrito", "Desativado"];
const FAIXAS = [
  "Não faturo ainda", "Até 50 mil/mês", "50 mil – 150 mil/mês", "150 mil – 500 mil/mês",
  "500 mil – 1 milhão/mês", "1 milhão – 5 milhões/mês", "5 milhões – 10 milhões/mês",
  "Acima de 10 milhões/mês",
];
const POR_PAGINA = 50;

// Colunas opcionais da lista (Nome e ações são fixas). Ordem + visibilidade
// ficam salvas no navegador.
const COLUNAS = {
  codigo:    "Código",
  tipo:      "Tipo",
  categoria: "Categoria",
  situacao:  "Situação",
  pagamento: "Pagamento",
  empresa:   "Empresa",
  telefone:  "Telefone",
  etapa:     "Etapa",
  presenca:  "Presença",
  cadastro:  "Cadastro",
};
const COLUNAS_PADRAO = ["codigo", "tipo", "categoria", "situacao", "pagamento", "etapa", "presenca", "cadastro"];
let colunas = [...COLUNAS_PADRAO];
try {
  const s = JSON.parse(localStorage.getItem("part_colunas") || "null");
  if (Array.isArray(s) && s.length) colunas = s.filter((c) => COLUNAS[c]);
} catch {}
const salvarColunas = () => { try { localStorage.setItem("part_colunas", JSON.stringify(colunas)); } catch {} };
const COL_DB = { categoria: "ingresso" };
const ALIAS_IMPORT = {
  "nome completo": "nome", "e-mail": "email", whatsapp: "telefone", celular: "telefone",
  fone: "telefone", turma: "tipo", categoria: "tipo", "forma de pagamento": "pagamento",
  status: "pagamento", qtd: "quantidade", quantidade: "quantidade",
  "tipo de ingresso": "ingresso", empresa: "empresa", "razão social": "empresa",
  "situação": "situacao", situacao: "situacao",
};
const normSituacao = (v) => {
  const n = String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return SITUACOES.find((s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") === n) || null;
};

let participantes = [], etapas = [], atividades = [], checkins = [], tiposIngresso = [];
let vista = "lista";
let pagina = 1;
const selecionados = new Set();
const FILTROS_VAZIO = {
  busca: "", campo: "", situacao: "", tipo: "", pagamento: "", dataDe: "", dataAte: "",
  categoria: "", etapa: "", atividade: "", presAtv: "", presenca: "",
  buscaPipe: "", tipoPipe: "",
};
const filtros = { ...FILTROS_VAZIO };

const badgeTipo = (t) => (t === "Anfitrião" ? "badge-laranja" : "badge-neutro");
const badgePag = (p) =>
  ({ Gratuito: "badge-neutro", Pago: "badge-ok", Convidado: "badge-info",
     Cancelado: "badge-erro", Reembolsado: "badge-alerta" }[p] || "badge-neutro");
const badgeSituacao = (s) =>
  ({ Confirmado: "badge-ok", Pendente: "badge-alerta", "Fila de espera": "badge-info",
     "Pré-inscrito": "badge-neutro", Desativado: "badge-erro" }[s] || "badge-neutro");
const situacaoDe = (p) => p.situacao || "Confirmado";
const ativo = (p) => situacaoDe(p) !== "Desativado";

// participante credenciado numa atividade (saldo de entradas > 0)
function credenciadoNaAtv(pid, atvId) {
  let n = 0;
  for (const c of checkins) {
    if (c.participante_id !== pid || c.atividade_id !== atvId) continue;
    n += c.acao === "entrada" ? 1 : -1;
  }
  return n > 0;
}
const categoriasIngresso = () =>
  [...new Set([
    ...participantes.map((p) => (p.ingresso || "").trim()),
    ...tiposIngresso.map((t) => (t.nome || "").trim()),
  ].filter(Boolean))].sort();

// <option>s do select de Ingresso: tipos cadastrados + o valor atual (se
// for uma categoria antiga que não está mais na lista).
function opcoesIngresso(atual) {
  const lista = [...new Set([...categoriasIngresso(), (atual || "").trim()].filter(Boolean))].sort();
  return lista.map((c) => `<option ${c === (atual || "").trim() ? "selected" : ""}>${esc(c)}</option>`).join("");
}
const nomeEtapa = (id) => etapas.find((e) => e.id === id)?.nome || "—";
const horaCurta = (iso) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
      .format(new Date(iso));
  } catch { return ""; }
};
const normTipo = (v) => {
  const n = String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return TIPOS.find((t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") === n) || null;
};
const normPag = (v) => {
  const n = String(v || "").toLowerCase().trim();
  return PAGAMENTOS.find((p) => p.toLowerCase() === n) || null;
};

carregar();

async function carregar() {
  try {
    [participantes, etapas, atividades, checkins, tiposIngresso] = await Promise.all([
      listParticipantes(), listEtapasParticipante(),
      listAtividades().catch(() => []), listCheckins().catch(() => []),
      listTiposIngresso().catch(() => []),
    ]);
    opcoes(el("f-tipo"), TIPOS, "Todos os tipos");
    opcoes(el("f-tipo-pipe"), TIPOS, "Todos os tipos");
    opcoes(el("f-pagamento"), PAGAMENTOS, "Todos os pagamentos");
    opcoes(el("f-situacao"), SITUACOES, "Todas (menos desativados)");
    el("f-etapa").innerHTML = `<option value="">Todas</option>` +
      etapas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join("");
    el("f-atividade").innerHTML = `<option value="">Não filtrar</option>` +
      atividades.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join("");
    el("f-categoria").innerHTML = `<option value="">Todas</option>` +
      categoriasIngresso().map((c) => `<option>${esc(c)}</option>`).join("");
    el("carregando").hidden = true;
    ligarEventos();
    render();
  } catch (e) {
    const falta = /participantes|etapas_participante/.test(e.message || "");
    const faltaCheckin = /codigo|presente|empresa|column .* does not exist/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0004_participantes.sql</code> no SQL Editor do Supabase para ativar esta tela.`
      : faltaCheckin
      ? `Rode a migração <code>supabase/migrations/0006_checkin.sql</code> no SQL Editor do Supabase.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

function opcoes(sel, arr, placeholder) {
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    arr.map((x) => `<option>${esc(x)}</option>`).join("");
}

function ligarEventos() {
  el("vistas").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      el("vistas").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
      b.classList.add("ativo");
      vista = b.dataset.vista;
      render();
    };
  });
  const refiltra = (fn) => (e) => { fn(e); pagina = 1; render(); };
  el("busca-pipe").addEventListener("input", debounce((e) => { filtros.buscaPipe = e.target.value.toLowerCase(); render(); }, 200));
  el("f-tipo-pipe").onchange = (e) => { filtros.tipoPipe = e.target.value; render(); };

  el("f-busca").addEventListener("input", debounce(refiltra((e) => { filtros.busca = e.target.value.toLowerCase(); }), 200));
  el("f-campo").onchange = refiltra((e) => { filtros.campo = e.target.value; });
  el("f-situacao").onchange = refiltra((e) => { filtros.situacao = e.target.value; });
  el("f-tipo").onchange = refiltra((e) => { filtros.tipo = e.target.value; });
  el("f-pagamento").onchange = refiltra((e) => { filtros.pagamento = e.target.value; });
  el("f-data-de").onchange = refiltra((e) => { filtros.dataDe = e.target.value; });
  el("f-data-ate").onchange = refiltra((e) => { filtros.dataAte = e.target.value; });
  el("f-categoria").onchange = refiltra((e) => { filtros.categoria = e.target.value; });
  el("f-etapa").onchange = refiltra((e) => { filtros.etapa = e.target.value; });
  el("f-atividade").onchange = refiltra((e) => { filtros.atividade = e.target.value; });
  el("f-pres-atv").onchange = refiltra((e) => { filtros.presAtv = e.target.value; });
  el("f-presenca").onchange = refiltra((e) => { filtros.presenca = e.target.value; });

  el("btn-toggle-filtros").onclick = () => {
    const painel = el("filtros-painel");
    painel.hidden = !painel.hidden;
    el("btn-toggle-filtros").setAttribute("aria-expanded", String(!painel.hidden));
    el("btn-toggle-filtros").classList.toggle("ativo", filtrosAtivos());
  };
  el("btn-limpar-filtros").onclick = () => {
    Object.assign(filtros, { ...FILTROS_VAZIO, buscaPipe: filtros.buscaPipe, tipoPipe: filtros.tipoPipe });
    ["f-busca", "f-campo", "f-situacao", "f-tipo", "f-pagamento", "f-data-de", "f-data-ate",
     "f-categoria", "f-etapa", "f-atividade", "f-pres-atv", "f-presenca"].forEach((id) => (el(id).value = ""));
    pagina = 1;
    render();
  };

  el("btn-cadastrar").innerHTML = icone("mais") + "Cadastrar";
  el("btn-cadastrar").onclick = () => abrirForm(null);
  el("btn-importar").innerHTML = icone("subir") + "Importar Excel";
  el("btn-importar").onclick = modalImportar;
  el("btn-exportar").innerHTML = icone("baixar") + "Exportar Excel";
  el("btn-exportar").onclick = () => exportar(filtrarLista());
  el("btn-email").innerHTML = icone("inbox") + "Enviar e-mail";
  el("btn-email").onclick = () => abrirEmailPara(filtrarLista());
  el("btn-colunas").innerHTML = icone("filtro") + "Colunas";
  el("btn-colunas").onclick = modalColunas;
  el("barra-acoes").querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = () => acaoEmMassa(b.dataset.acao);
  });
}

function renderCabecalho() {
  el("thead-part").innerHTML =
    `<th class="col-check"><input type="checkbox" id="check-todos" aria-label="Selecionar todos" /></th>
     <th>Nome</th>
     ${colunas.map((c) => `<th>${esc(COLUNAS[c])}</th>`).join("")}
     <th></th>`;
  el("check-todos").onchange = (e) => {
    const dados = filtrarLista();
    if (e.target.checked) dados.forEach((p) => selecionados.add(p.id));
    else dados.forEach((p) => selecionados.delete(p.id));
    render();
  };
}

/* ---- render ---- */
function render() {
  el("vista-lista").hidden = vista !== "lista";
  el("vista-pipeline").hidden = vista !== "pipeline";
  vista === "lista" ? renderLista() : renderPipeline();
}

function filtrosAtivos() {
  return ["busca", "campo", "situacao", "tipo", "pagamento", "dataDe", "dataAte",
    "categoria", "etapa", "atividade", "presAtv", "presenca"].some((k) => filtros[k]);
}

function filtrarLista() {
  const diaDe = filtros.dataDe ? new Date(filtros.dataDe + "T00:00:00") : null;
  const diaAte = filtros.dataAte ? new Date(filtros.dataAte + "T23:59:59") : null;
  return participantes.filter((p) => {
    // desativados: escondidos, a não ser que o filtro peça exatamente eles
    if (situacaoDe(p) === "Desativado" && filtros.situacao !== "Desativado") return false;
    if (filtros.situacao && situacaoDe(p) !== filtros.situacao) return false;
    if (filtros.tipo && p.tipo !== filtros.tipo) return false;
    if (filtros.pagamento && p.pagamento !== filtros.pagamento) return false;
    if (filtros.categoria && (p.ingresso || "").trim() !== filtros.categoria) return false;
    if (filtros.etapa && p.etapa_id !== filtros.etapa) return false;
    if (filtros.presenca === "sim" && !p.presente) return false;
    if (filtros.presenca === "nao" && p.presente) return false;
    if (filtros.atividade && filtros.presAtv) {
      const dentro = credenciadoNaAtv(p.id, filtros.atividade);
      if (filtros.presAtv === "sim" && !dentro) return false;
      if (filtros.presAtv === "nao" && dentro) return false;
    }
    if (diaDe && new Date(p.created_at) < diaDe) return false;
    if (diaAte && new Date(p.created_at) > diaAte) return false;
    if (filtros.busca) {
      const campos = filtros.campo
        ? [p[filtros.campo]]
        : [p.nome, p.email, p.telefone, p.empresa, p.codigo];
      const alvo = campos.filter(Boolean).join(" ").toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

function abrirEmailPara(dados) {
  const comEmail = dados.filter((p) => (p.email || "").includes("@"));
  if (!comEmail.length) { toast("Nenhum destinatário com e-mail.", "erro"); return; }
  abrirEnvioEmail(comEmail, eventoNome());
}

function renderLista() {
  renderCabecalho();
  const dados = filtrarLista();
  const presentes = dados.filter((p) => p.presente).length;
  const totalAtivos = participantes.filter(ativo).length;
  el("contador").textContent =
    `${dados.length} de ${totalAtivos} participantes · ${presentes} presente${presentes === 1 ? "" : "s"}`;
  el("btn-toggle-filtros").classList.toggle("ativo", filtrosAtivos());

  el("wrap").hidden = dados.length === 0;
  el("vazio").hidden = dados.length !== 0;

  const totalPag = Math.max(1, Math.ceil(dados.length / POR_PAGINA));
  if (pagina > totalPag) pagina = totalPag;
  const fatia = dados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  // seleção limpa ids que sumiram do filtro
  [...selecionados].forEach((id) => { if (!dados.some((p) => p.id === id)) selecionados.delete(id); });
  sincronizarBarra(dados);

  if (dados.length) {
    el("linhas").innerHTML = fatia.map((p) => linhaHtml(p)).join("");
    ligarLinhas();
  }
  renderPaginacao(dados.length, totalPag);
}

function linhaHtml(p) {
  const marcado = selecionados.has(p.id);
  return `<tr data-id="${p.id}" class="${marcado ? "sel" : ""}">
    <td class="col-check"><input type="checkbox" data-sel ${marcado ? "checked" : ""} aria-label="Selecionar ${esc(p.nome)}" /></td>
    <td>
      <strong>${esc(p.nome)}</strong>
      ${p.email ? `<span class="cel-sub">${esc(p.email)}</span>` : ""}
    </td>
    ${colunas.map((c) => celulaHtml(p, c)).join("")}
    <td class="linha-acoes">
      <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
      <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
    </td>
  </tr>`;
}

function celulaHtml(p, c) {
  switch (c) {
    case "codigo":
      return `<td><span class="chip-codigo">${esc(p.codigo || "—")}</span></td>`;
    case "tipo":
      return `<td class="celula-edit" data-campo="tipo" title="Alterar tipo"><span class="badge ${badgeTipo(p.tipo)}">${esc(p.tipo)}</span>${lapis()}</td>`;
    case "categoria": {
      const cat = (p.ingresso || "").trim();
      return `<td class="celula-edit" data-campo="categoria" title="Alterar categoria">${cat ? `<span class="chip-cat">${esc(cat)}</span>` : `<span class="cel-tenue">—</span>`}${lapis()}</td>`;
    }
    case "situacao":
      return `<td class="celula-edit" data-campo="situacao" title="Alterar situação"><span class="badge ${badgeSituacao(situacaoDe(p))}">${esc(situacaoDe(p))}</span>${lapis()}</td>`;
    case "pagamento":
      return `<td class="celula-edit" data-campo="pagamento" title="Alterar pagamento"><span class="badge ${badgePag(p.pagamento)}">${esc(p.pagamento)}</span>${lapis()}</td>`;
    case "empresa":
      return `<td>${p.empresa ? esc(p.empresa) : `<span class="cel-tenue">—</span>`}</td>`;
    case "telefone":
      return `<td>${p.telefone ? esc(p.telefone) : `<span class="cel-tenue">—</span>`}</td>`;
    case "etapa":
      return `<td class="celula-edit" data-campo="etapa" title="Alterar etapa"><span>${esc(nomeEtapa(p.etapa_id))}</span>${lapis()}</td>`;
    case "presenca":
      return `<td>${p.presente
        ? `<span class="badge badge-ok" title="Check-in às ${esc(horaCurta(p.checkin_at))}">Presente</span>`
        : `<span class="cel-tenue">—</span>`}</td>`;
    case "cadastro":
      return `<td>${formatarData(p.created_at)}</td>`;
    default:
      return "<td></td>";
  }
}

/* ---- Modal de colunas ---- */
function modalColunas() {
  let ordem = [...colunas, ...Object.keys(COLUNAS).filter((c) => !colunas.includes(c))];
  const visiveis = new Set(colunas);
  const corpo = () => ordem.map((c, i) => `
    <div class="col-cfg" data-c="${c}">
      <label><input type="checkbox" data-vis ${visiveis.has(c) ? "checked" : ""} /> ${esc(COLUNAS[c])}</label>
      <span class="linha-acoes">
        <button type="button" class="icone-btn" data-mv="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
        <button type="button" class="icone-btn" data-mv="1" ${i === ordem.length - 1 ? "disabled" : ""} aria-label="Descer">▼</button>
      </span>
    </div>`).join("");

  abrirModal({
    titulo: "Colunas da lista",
    textoConfirmar: "Aplicar",
    corpoHtml: `<p class="pagina-sub" style="margin:0 0 12px">Marque as colunas que aparecem e use ▲ ▼ para reordenar. Nome fica sempre visível.</p>
      <div id="col-lista">${corpo()}</div>
      <button type="button" class="btn btn-fantasma btn-sm" id="col-reset" style="margin-top:8px">Restaurar padrão</button>`,
    aoMontar: (root) => {
      const redraw = () => { root.querySelector("#col-lista").innerHTML = corpo(); wire(); };
      const wire = () => {
        root.querySelectorAll(".col-cfg").forEach((row) => {
          const c = row.dataset.c;
          row.querySelector("[data-vis]").onchange = (e) => {
            e.target.checked ? visiveis.add(c) : visiveis.delete(c);
          };
          row.querySelectorAll("[data-mv]").forEach((b) => {
            b.onclick = () => {
              const i = ordem.indexOf(c);
              const j = i + Number(b.dataset.mv);
              if (j < 0 || j >= ordem.length) return;
              [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
              redraw();
            };
          });
        });
      };
      wire();
      root.querySelector("#col-reset").onclick = () => {
        ordem = [...COLUNAS_PADRAO, ...Object.keys(COLUNAS).filter((c) => !COLUNAS_PADRAO.includes(c))];
        visiveis.clear();
        COLUNAS_PADRAO.forEach((c) => visiveis.add(c));
        redraw();
      };
    },
    onConfirmar: () => {
      colunas = ordem.filter((c) => visiveis.has(c));
      if (!colunas.length) colunas = [...COLUNAS_PADRAO];
      salvarColunas();
      render();
    },
  });
}

const lapis = () => `<span class="cel-lapis">${icone("editar")}</span>`;

function ligarLinhas() {
  el("linhas").querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector("[data-sel]").onclick = (e) => {
      e.stopPropagation();
      e.target.checked ? selecionados.add(id) : selecionados.delete(id);
      tr.classList.toggle("sel", e.target.checked);
      sincronizarBarra(filtrarLista());
    };
    tr.querySelectorAll(".celula-edit").forEach((td) => {
      td.onclick = (e) => { e.stopPropagation(); editarCelula(id, td.dataset.campo, td); };
    });
    tr.querySelector("[data-excluir]").onclick = (e) => { e.stopPropagation(); excluir(id); };
    tr.querySelector("[data-editar]").onclick = (e) => { e.stopPropagation(); abrirForm(participantes.find((x) => x.id === id)); };
    tr.onclick = () => abrirGavetaDetalhe(id);
  });
}

async function editarCelula(id, campo, td) {
  const p = participantes.find((x) => x.id === id);
  if (!p) return;
  let itens, atualValor;
  if (campo === "tipo") { itens = TIPOS.map((t) => ({ valor: t, rotulo: t })); atualValor = p.tipo; }
  else if (campo === "pagamento") { itens = PAGAMENTOS.map((t) => ({ valor: t, rotulo: t })); atualValor = p.pagamento; }
  else if (campo === "situacao") { itens = SITUACOES.map((t) => ({ valor: t, rotulo: t })); atualValor = situacaoDe(p); }
  else if (campo === "categoria") {
    itens = [{ valor: "", rotulo: "— sem tipo —" }, ...categoriasIngresso().map((c) => ({ valor: c, rotulo: c }))];
    atualValor = (p.ingresso || "").trim();
  } else {
    itens = [{ valor: "", rotulo: "Sem etapa" }, ...etapas.map((e) => ({ valor: e.id, rotulo: e.nome }))];
    atualValor = p.etapa_id || "";
  }
  itens.forEach((it) => (it.atual = it.valor === atualValor));
  const escolha = await abrirMenu(td, itens);
  if (escolha === null || escolha === atualValor) return;
  td.classList.add("salvando");
  try {
    if (campo === "etapa") {
      const salvo = await salvar("participantes", { id, etapa_id: escolha || null });
      Object.assign(p, salvo);
    } else if (campo === "tipo") {
      const salvo = await salvar("participantes", { id, tipo: escolha });
      Object.assign(p, salvo);
      await sincParticipanteAnfitriao(p).catch((e) => console.warn(e));
      participantes = await listParticipantes();
    } else {
      const salvo = await salvar("participantes", { id, [COL_DB[campo] || campo]: escolha || null });
      Object.assign(p, salvo);
    }
    toast("Atualizado.", "ok");
    render();
  } catch (e) {
    toast(e.message, "erro");
    td.classList.remove("salvando");
  }
}

/* ---- Barra de ações em massa ---- */
function sincronizarBarra(dados) {
  const n = selecionados.size;
  el("barra-acoes").hidden = n === 0;
  el("sel-cont").textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
  const todos = el("check-todos");
  const noFiltro = dados.filter((p) => selecionados.has(p.id)).length;
  todos.checked = dados.length > 0 && noFiltro === dados.length;
  todos.indeterminate = noFiltro > 0 && noFiltro < dados.length;
}

async function acaoEmMassa(acao) {
  const ids = [...selecionados];
  if (!ids.length && acao !== "limpar") return;

  if (acao === "limpar") { selecionados.clear(); render(); return; }

  if (acao === "exportar") {
    exportar(participantes.filter((p) => selecionados.has(p.id)));
    return;
  }

  if (acao === "email") {
    abrirEmailPara(participantes.filter((p) => selecionados.has(p.id)));
    return;
  }

  if (acao === "excluir") {
    if (!confirmar(`Excluir ${ids.length} participante(s) da lista?`)) return;
    try {
      for (const id of ids) {
        await desvincularAoExcluirParticipante(participantes.find((x) => x.id === id)).catch(() => {});
      }
      await removerEmLote("participantes", ids);
      selecionados.clear();
      toast(`${ids.length} participante(s) excluído(s).`, "ok");
      await recarregar();
    } catch (e) { toast(e.message, "erro"); }
    return;
  }

  if (acao === "presente" || acao === "ausente") {
    try {
      await atualizarEmLote("participantes", ids, acao === "presente"
        ? { presente: true, checkin_at: new Date().toISOString() }
        : { presente: false, checkin_at: null });
      await inserirLote("checkins", ids.map((id) => ({
        participante_id: id, acao: acao === "presente" ? "entrada" : "saida", origem: "lista",
      }))).catch(() => {});
      selecionados.clear();
      toast(`Presença atualizada para ${ids.length} participante(s).`, "ok");
      await recarregar();
    } catch (e) { toast(e.message, "erro"); }
    return;
  }

  // situacao / tipo / pagamento / etapa → menu ancorado no botão
  const btn = el("barra-acoes").querySelector(`[data-acao="${acao}"]`);
  let itens;
  if (acao === "tipo") itens = TIPOS.map((t) => ({ valor: t, rotulo: t }));
  else if (acao === "situacao") itens = SITUACOES.map((t) => ({ valor: t, rotulo: t }));
  else if (acao === "pagamento") itens = PAGAMENTOS.map((t) => ({ valor: t, rotulo: t }));
  else itens = [{ valor: "", rotulo: "Sem etapa" }, ...etapas.map((e) => ({ valor: e.id, rotulo: e.nome }))];
  const escolha = await abrirMenu(btn, itens);
  if (escolha === null) return;
  try {
    if (acao === "etapa") {
      await atualizarEmLote("participantes", ids, { etapa_id: escolha || null });
    } else if (acao === "pagamento" || acao === "situacao") {
      await atualizarEmLote("participantes", ids, { [acao]: escolha });
    } else {
      // tipo: pode virar Anfitrião → precisa criar/limpar vínculo por linha
      await atualizarEmLote("participantes", ids, { tipo: escolha });
      participantes = await listParticipantes();
      for (const p of participantes.filter((x) => selecionados.has(x.id))) {
        await sincParticipanteAnfitriao(p).catch((e) => console.warn(e));
      }
    }
    selecionados.clear();
    toast(`${ids.length} participante(s) atualizado(s).`, "ok");
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

function renderPaginacao(total, totalPag) {
  const box = el("paginacao");
  if (totalPag <= 1) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `
    <button class="btn btn-sm btn-secundario" data-pg="ant" ${pagina === 1 ? "disabled" : ""}>‹ Anterior</button>
    <span>página ${pagina} de ${totalPag}</span>
    <button class="btn btn-sm btn-secundario" data-pg="prox" ${pagina === totalPag ? "disabled" : ""}>Próxima ›</button>`;
  box.querySelector('[data-pg="ant"]').onclick = () => { pagina = Math.max(1, pagina - 1); render(); window.scrollTo({ top: 0 }); };
  box.querySelector('[data-pg="prox"]').onclick = () => { pagina = Math.min(totalPag, pagina + 1); render(); window.scrollTo({ top: 0 }); };
}

function renderPipeline() {
  const dados = participantes.filter((p) => {
    if (!ativo(p)) return false;
    if (filtros.tipoPipe && p.tipo !== filtros.tipoPipe) return false;
    if (filtros.buscaPipe) {
      const alvo = `${p.nome} ${p.email || ""}`.toLowerCase();
      if (!alvo.includes(filtros.buscaPipe)) return false;
    }
    return true;
  });
  const semEtapa = dados.filter((p) => !p.etapa_id);
  const colunas = etapas.map((et) => ({ et, itens: dados.filter((p) => p.etapa_id === et.id) }));
  if (semEtapa.length) colunas.unshift({ et: null, itens: semEtapa });

  el("kanban").innerHTML = colunas
    .map(({ et, itens }) => {
      const cor = et?.cor || "var(--cinza-400)";
      return `<div class="coluna">
        <div class="coluna-topo"><span class="ponto" style="background:${esc(cor)}"></span>
          ${esc(et ? et.nome : "Sem etapa")}<span class="qtd">${itens.length}</span></div>
        <div class="coluna-corpo">
          ${itens.map((p) => cardPart(p)).join("") || `<p class="pagina-sub" style="margin:8px 0;font-size:.78rem">—</p>`}
        </div>
      </div>`;
    })
    .join("");

  el("kanban").querySelectorAll(".card-part").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector("[data-mover]").onclick = (e) => e.stopPropagation();
    card.querySelector("[data-mover]").onchange = async (e) => {
      try {
        await salvar("participantes", { id, etapa_id: e.target.value || null });
        participantes = await listParticipantes();
        toast("Movido.", "ok");
        render();
      } catch (err) { toast(err.message, "erro"); }
    };
    card.querySelector(".card-corpo").onclick = () => abrirGavetaDetalhe(id);
  });
}

function cardPart(p) {
  return `<div class="card-part" data-id="${p.id}">
    <div class="card-corpo">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
        <strong style="font-size:.9rem">${esc(p.nome)}</strong>
        <span class="badge ${badgeTipo(p.tipo)}" style="font-size:.65rem">${esc(p.tipo)}</span>
      </div>
      ${p.faturamento ? `<div class="pagina-sub" style="margin:4px 0 0;font-size:.75rem">${esc(p.faturamento)}</div>` : ""}
      <div class="pagina-sub" style="margin:2px 0 0;font-size:.72rem">${esc(p.email || p.telefone || "")}</div>
      <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="badge ${badgePag(p.pagamento)}" style="font-size:.65rem">${esc(p.pagamento)}</span>
        ${p.presente ? `<span class="badge badge-ok" style="font-size:.65rem">Presente</span>` : ""}
        <span class="pagina-sub" style="margin:0;font-size:.68rem">${formatarData(p.created_at)}</span>
      </div>
    </div>
    <select class="select" data-mover style="margin-top:8px;font-size:.8rem;padding:6px 8px">
      <option value="">Sem etapa</option>
      ${etapas.map((e) => `<option value="${e.id}" ${e.id === p.etapa_id ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}
    </select>
  </div>`;
}

/* ---- Cadastrar / editar ---- */
function abrirForm(p) {
  abrirModal({
    titulo: p ? "Editar participante" : "Novo participante",
    textoConfirmar: p ? "Salvar" : "Cadastrar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required value="${esc(p?.nome || "")}" /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" value="${esc(p?.email || "")}" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" value="${esc(p?.telefone || "")}" /></label>
      <label class="campo"><span>Empresa</span><input class="input" name="empresa" value="${esc(p?.empresa || "")}" /></label>
      <label class="campo"><span>Tipo *</span>
        <select class="select" name="tipo">${TIPOS.map((t) => `<option ${t === (p?.tipo || "Convidado") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="campo"><span>Ingresso</span>
        <select class="select" name="ingresso">
          <option value="">— sem tipo —</option>
          ${opcoesIngresso(p?.ingresso)}
        </select>
        ${tiposIngresso.length ? "" : `<span class="cel-tenue" style="font-size:.72rem">Cadastre os tipos em “Tipos de ingresso”.</span>`}</label>
      <label class="campo"><span>Situação *</span>
        <select class="select" name="situacao">${SITUACOES.map((s) => `<option ${s === (p?.situacao || "Confirmado") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="campo"><span>Faturamento</span>
        <select class="select" name="faturamento"><option value="">—</option>
          ${FAIXAS.map((f) => `<option ${f === p?.faturamento ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label class="campo"><span>Pagamento</span>
        <select class="select" name="pagamento">${PAGAMENTOS.map((x) => `<option ${x === (p?.pagamento || "Gratuito") ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label class="campo"><span>Quantidade</span><input class="input" name="quantidade" type="number" min="1" value="${p?.quantidade ?? 1}" /></label>
      <label class="campo"><span>Etapa do pipeline</span>
        <select class="select" name="etapa_id"><option value="">Sem etapa</option>
          ${etapas.map((e) => `<option value="${e.id}" ${e.id === p?.etapa_id ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}</select></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const reg = {
        nome: f.nome.trim(), email: f.email.trim() || null, telefone: f.telefone.trim() || null,
        empresa: f.empresa.trim() || null,
        tipo: f.tipo, ingresso: f.ingresso.trim() || null, faturamento: f.faturamento || null,
        situacao: f.situacao || "Confirmado",
        pagamento: f.pagamento, quantidade: Number(f.quantidade) || 1, etapa_id: f.etapa_id || null,
      };
      if (p) reg.id = p.id;
      const salvo = await salvar("participantes", reg);
      await sincParticipanteAnfitriao(salvo).catch((e) => console.warn(e));
      toast(p ? "Participante atualizado." : "Participante cadastrado.", "ok");
      await recarregar();
    },
  });
}

async function recarregar() {
  tiposIngresso = await listTiposIngresso().catch(() => tiposIngresso);
  participantes = await listParticipantes();
  render();
}

/* ---- Gaveta ---- */
function abrirGavetaDetalhe(id) {
  const p = participantes.find((x) => x.id === id);
  if (!p) return;
  abrirGaveta(
    esc(p.nome),
    `
    <div class="secao">
      <span class="badge ${badgeTipo(p.tipo)}">${esc(p.tipo)}</span>
      <span class="badge ${badgeSituacao(situacaoDe(p))}">${esc(situacaoDe(p))}</span>
      <span class="badge ${badgePag(p.pagamento)}">${esc(p.pagamento)}</span>
      <span class="badge badge-neutro">${esc(nomeEtapa(p.etapa_id))}</span>
      <span class="chip-codigo">${esc(p.codigo || "—")}</span>
    </div>
    <div class="secao">
      <p style="margin:4px 0">${esc(p.email || "—")}</p>
      <p style="margin:4px 0">${esc(p.telefone || "—")}</p>
      ${p.empresa ? `<p style="margin:4px 0">${esc(p.empresa)}</p>` : ""}
      <p class="pagina-sub" style="margin:4px 0">Cadastrado em ${formatarData(p.created_at, true)}</p>
      ${(p.email || "").includes("@") ? `<button class="btn btn-secundario btn-sm" id="g-email" style="margin-top:8px">Enviar e-mail</button>` : ""}
    </div>
    <div class="secao">
      <h4>Credenciamento</h4>
      <p style="margin:0 0 10px">${p.presente
        ? `<span class="badge badge-ok">Presente</span> desde ${esc(horaCurta(p.checkin_at))}`
        : `<span class="cel-tenue">Ainda não fez check-in</span>`}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${p.presente ? "btn-secundario" : "btn-primario"}" id="g-presenca">
          ${p.presente ? "Desfazer presença" : "Credenciar"}
        </button>
        <button class="btn btn-secundario" id="g-cracha">Imprimir crachá</button>
      </div>
    </div>
    ${
      p.anfitriao_id
        ? `<div class="secao"><div class="aviso" style="margin:0">
             Este participante também está na <a href="anfitrioes.html" style="font-weight:700;text-decoration:underline">Gestão de anfitriões</a>.
           </div></div>`
        : ""
    }
    <div class="secao">
      <button class="btn btn-primario" id="g-editar">Editar dados</button>
    </div>
    <div class="secao">
      <h4>Situação</h4>
      <select class="select" id="g-situacao">
        ${SITUACOES.map((s) => `<option ${s === situacaoDe(p) ? "selected" : ""}>${s}</option>`).join("")}</select>
    </div>
    <div class="secao">
      <h4>Etapa do pipeline</h4>
      <select class="select" id="g-etapa"><option value="">Sem etapa</option>
        ${etapas.map((e) => `<option value="${e.id}" ${e.id === p.etapa_id ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}</select>
    </div>
    <div class="secao">
      <h4>Observação</h4>
      <textarea class="input" id="g-obs" rows="3">${esc(p.observacao || "")}</textarea>
      <button class="btn btn-secundario" id="g-salvar-obs" style="margin-top:8px">Salvar observação</button>
    </div>
    <div class="secao zona-perigo">
      <p>Remover da lista de participantes.${p.anfitriao_id ? " (O registro na gestão de anfitriões não é apagado.)" : ""}</p>
      <button class="btn btn-perigo" id="g-excluir">Excluir participante</button>
    </div>`
  );
  const g = document.getElementById("gaveta");
  g.querySelector("#g-editar").onclick = () => { fecharGaveta(); abrirForm(p); };
  g.querySelector("#g-presenca").onclick = async () => {
    try {
      const entrar = !p.presente;
      const salvo = await registrarCheckin(p.id, entrar ? "entrada" : "saida", "lista");
      Object.assign(p, salvo);
      toast(entrar ? "Participante credenciado." : "Presença removida.", "ok");
      if (entrar) imprimirCracha(p, eventoNome());
      await recarregar();
      abrirGavetaDetalhe(id);
    } catch (e) { toast(e.message, "erro"); }
  };
  g.querySelector("#g-cracha").onclick = () => imprimirCracha(p, eventoNome());
  g.querySelector("#g-email")?.addEventListener("click", () => abrirEnvioEmail([p], eventoNome()));
  g.querySelector("#g-situacao").onchange = async (e) => {
    try {
      await salvar("participantes", { id: p.id, situacao: e.target.value });
      p.situacao = e.target.value;
      toast("Situação atualizada.", "ok");
      await recarregar();
    } catch (err) { toast(err.message, "erro"); }
  };
  g.querySelector("#g-etapa").onchange = async (e) => {
    try {
      await salvar("participantes", { id: p.id, etapa_id: e.target.value || null });
      toast("Etapa atualizada.", "ok");
      await recarregar();
    } catch (err) { toast(err.message, "erro"); }
  };
  g.querySelector("#g-salvar-obs").onclick = async () => {
    try {
      await salvar("participantes", { id: p.id, observacao: g.querySelector("#g-obs").value.trim() || null });
      toast("Observação salva.", "ok");
      await recarregar();
      fecharGaveta();
    } catch (err) { toast(err.message, "erro"); }
  };
  g.querySelector("#g-excluir").onclick = () => excluir(p.id);
}

async function excluir(id) {
  const p = participantes.find((x) => x.id === id);
  if (!confirmar(`Excluir "${p?.nome}" da lista de participantes?`)) return;
  try {
    await desvincularAoExcluirParticipante(p).catch(() => {});
    await remover("participantes", id);
    selecionados.delete(id);
    toast("Participante excluído.", "ok");
    fecharGaveta();
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

/* ---- Importar ---- */
const MODELO =
  "nome;email;telefone;empresa;tipo;ingresso;faturamento;pagamento;quantidade\n" +
  "Maria Silva;maria@ex.com;11999990000;Acme Ltda;Convidado;Convite;150 mil – 500 mil/mês;Gratuito;1\n" +
  "João Souza;joao@ex.com;11988887777;JS Co;Anfitrião;Convite;;Gratuito;1";

function modalImportar() {
  abrirModal({
    titulo: "Importar participantes",
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole a tabela (Excel/Sheets) ou selecione um CSV. Colunas: <b>nome</b>
        (obrigatória), email, telefone, empresa, tipo, ingresso, faturamento,
        pagamento, quantidade. Quem vier com <b>tipo = Anfitrião</b> também entra
        na Gestão de anfitriões (sem duplicar, casando por e-mail).
      </p>
      <a href="data:text/csv;charset=utf-8,${encodeURIComponent(MODELO)}" download="modelo-participantes.csv"
         style="font-size:.8rem;font-weight:600;color:var(--cor-laranja-forte)">↓ baixar modelo</a>
      <label class="campo" style="margin-top:12px"><span>Colar tabela</span>
        <textarea class="input" name="texto" rows="7"></textarea></label>
      <label class="campo"><span>…ou arquivo CSV</span>
        <input class="input" type="file" name="arquivo" accept=".csv,.txt,.tsv" /></label>`,
    aoMontar: (root) => {
      const arq = root.querySelector('[name="arquivo"]');
      arq.onchange = () => {
        const f = arq.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { root.querySelector('[name="texto"]').value = r.result; };
        r.readAsText(f, "utf-8");
      };
    },
    onConfirmar: async (form) => {
      const linhas = parsearTabela(form.querySelector('[name="texto"]').value, ALIAS_IMPORT);
      const validas = linhas.filter((l) => (l.nome || "").trim());
      if (!validas.length) { toast("Nenhuma linha com nome.", "erro"); return false; }

      const registros = validas.map((l) => ({
        nome: l.nome.trim(),
        email: (l.email || "").trim() || null,
        telefone: (l.telefone || "").trim() || null,
        empresa: (l.empresa || "").trim() || null,
        tipo: normTipo(l.tipo) || "Convidado",
        ingresso: (l.ingresso || "").trim() || null,
        faturamento: (l.faturamento || "").trim() || null,
        situacao: normSituacao(l.situacao) || "Confirmado",
        pagamento: normPag(l.pagamento) || "Gratuito",
        quantidade: Number(l.quantidade) || 1,
        etapa_id: etapas[0]?.id || null,
      }));
      const criados = await inserirLote("participantes", registros);
      // quem entrou como Anfitrião também vai para a aba Anfitriões (casa por e-mail)
      for (const novo of criados.filter((p) => p.tipo === "Anfitrião")) {
        await sincParticipanteAnfitriao(novo).catch((e) => console.warn(e));
      }
      const ign = linhas.length - validas.length;
      toast(`${registros.length} participante(s) importado(s).` + (ign ? ` ${ign} ignorada(s).` : ""), "ok");
      await recarregar();
    },
  });
}

/* ---- Exportar ---- */
function exportar(dados) {
  if (!dados.length) { toast("Nada para exportar.", "erro"); return; }
  const csv = gerarCSV(dados, [
    { chave: "codigo", rotulo: "Código" },
    { chave: "nome", rotulo: "Nome" },
    { chave: "email", rotulo: "E-mail" },
    { chave: "telefone", rotulo: "Telefone" },
    { chave: "empresa", rotulo: "Empresa" },
    { chave: "tipo", rotulo: "Tipo" },
    { rotulo: "Situação", valor: (p) => situacaoDe(p) },
    { chave: "ingresso", rotulo: "Ingresso" },
    { chave: "faturamento", rotulo: "Faturamento" },
    { chave: "pagamento", rotulo: "Pagamento" },
    { chave: "quantidade", rotulo: "Quantidade" },
    { rotulo: "Etapa", valor: (p) => nomeEtapa(p.etapa_id) },
    { rotulo: "Presente", valor: (p) => (p.presente ? "Sim" : "Não") },
    { rotulo: "Check-in", valor: (p) => formatarData(p.checkin_at, true) },
    { rotulo: "Data de cadastro", valor: (p) => formatarData(p.created_at) },
  ]);
  baixarCSV("participantes.csv", csv);
  toast("Arquivo gerado.", "ok");
}
