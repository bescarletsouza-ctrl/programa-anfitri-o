// =============================================================================
// Participantes do evento — visão Lista (tabela) e visão Pipeline (kanban).
// Lista manual. tipo "Anfitrião" também cria/vincula um registro em anfitrioes.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, abrirModal, abrirGaveta,
  fecharGaveta, toast, confirmar, icone,
} from "./ui.js";
import {
  listParticipantes, listEtapasParticipante, listAnfitrioes, listEstagios,
  salvar, remover, inserirLote,
} from "./supabase.js";
import { parsearTabela, gerarCSV, baixarCSV } from "./tabela.js";

iniciarPagina("participantes");
const el = (id) => document.getElementById(id);

const TIPOS = ["Convidado", "Anfitrião", "Acompanhante", "Comprador", "Outro"];
const PAGAMENTOS = ["Gratuito", "Pago", "Convidado", "Cancelado", "Reembolsado"];
const FAIXAS = [
  "Não faturo ainda", "Até 50 mil/mês", "50 mil – 150 mil/mês", "150 mil – 500 mil/mês",
  "500 mil – 1 milhão/mês", "1 milhão – 5 milhões/mês", "5 milhões – 10 milhões/mês",
  "Acima de 10 milhões/mês",
];
const ALIAS_IMPORT = {
  "nome completo": "nome", "e-mail": "email", whatsapp: "telefone", celular: "telefone",
  fone: "telefone", turma: "tipo", categoria: "tipo", "forma de pagamento": "pagamento",
  status: "pagamento", qtd: "quantidade", quantidade: "quantidade",
  "tipo de ingresso": "ingresso",
};

let participantes = [], etapas = [], anfitrioes = [], estagios = [];
let vista = "lista";
const filtros = { busca: "", tipo: "", pagamento: "", etapa: "", buscaPipe: "", tipoPipe: "" };

const badgeTipo = (t) => (t === "Anfitrião" ? "badge-laranja" : "badge-neutro");
const badgePag = (p) =>
  ({ Gratuito: "badge-neutro", Pago: "badge-ok", Convidado: "badge-info",
     Cancelado: "badge-erro", Reembolsado: "badge-alerta" }[p] || "badge-neutro");
const nomeEtapa = (id) => etapas.find((e) => e.id === id)?.nome || "—";
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
    [participantes, etapas, anfitrioes, estagios] = await Promise.all([
      listParticipantes(), listEtapasParticipante(),
      listAnfitrioes().catch(() => []), listEstagios().catch(() => []),
    ]);
    opcoes(el("f-tipo"), TIPOS, "Todos os tipos");
    opcoes(el("f-tipo-pipe"), TIPOS, "Todos os tipos");
    opcoes(el("f-pagamento"), PAGAMENTOS, "Todos os pagamentos");
    el("f-etapa").innerHTML = `<option value="">Todas as etapas</option>` +
      etapas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join("");
    el("carregando").hidden = true;
    ligarEventos();
    render();
  } catch (e) {
    const falta = /participantes|etapas_participante/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0004_participantes.sql</code> no SQL Editor do Supabase para ativar esta tela.`
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
  el("busca").addEventListener("input", debounce((e) => { filtros.busca = e.target.value.toLowerCase(); render(); }, 200));
  el("busca-pipe").addEventListener("input", debounce((e) => { filtros.buscaPipe = e.target.value.toLowerCase(); render(); }, 200));
  el("f-tipo").onchange = (e) => { filtros.tipo = e.target.value; render(); };
  el("f-pagamento").onchange = (e) => { filtros.pagamento = e.target.value; render(); };
  el("f-etapa").onchange = (e) => { filtros.etapa = e.target.value; render(); };
  el("f-tipo-pipe").onchange = (e) => { filtros.tipoPipe = e.target.value; render(); };
  el("btn-cadastrar").innerHTML = icone("mais") + "Cadastrar";
  el("btn-cadastrar").onclick = () => abrirForm(null);
  el("btn-importar").innerHTML = icone("subir") + "Importar Excel";
  el("btn-importar").onclick = modalImportar;
  el("btn-exportar").innerHTML = icone("baixar") + "Exportar Excel";
  el("btn-exportar").onclick = exportar;
}

/* ---- render ---- */
function render() {
  el("vista-lista").hidden = vista !== "lista";
  el("vista-pipeline").hidden = vista !== "pipeline";
  vista === "lista" ? renderLista() : renderPipeline();
}

function filtrarLista() {
  return participantes.filter((p) => {
    if (filtros.tipo && p.tipo !== filtros.tipo) return false;
    if (filtros.pagamento && p.pagamento !== filtros.pagamento) return false;
    if (filtros.etapa && p.etapa_id !== filtros.etapa) return false;
    if (filtros.busca) {
      const alvo = `${p.nome} ${p.email || ""} ${p.telefone || ""}`.toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

function renderLista() {
  const dados = filtrarLista();
  el("contador").textContent = `${dados.length} de ${participantes.length} participantes`;
  el("wrap").hidden = dados.length === 0;
  el("vazio").hidden = dados.length !== 0;
  if (!dados.length) return;
  el("linhas").innerHTML = dados
    .map(
      (p) => `<tr data-id="${p.id}">
        <td><strong>${esc(p.nome)}</strong></td>
        <td>${esc(p.email || "—")}</td>
        <td>${esc(p.telefone || "—")}</td>
        <td><span class="badge ${badgeTipo(p.tipo)}">${esc(p.tipo)}</span></td>
        <td>${esc(p.ingresso || "—")}</td>
        <td>${esc(p.faturamento || "—")}</td>
        <td><span class="badge ${badgePag(p.pagamento)}">${esc(p.pagamento)}</span></td>
        <td>${p.quantidade || 1}</td>
        <td>${formatarData(p.created_at)}</td>
        <td class="linha-acoes">
          <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
          <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
        </td>
      </tr>`
    )
    .join("");
  el("linhas").querySelectorAll("tr").forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest("[data-excluir]")) return excluir(tr.dataset.id);
      abrirGavetaDetalhe(tr.dataset.id);
    };
  });
}

function renderPipeline() {
  const dados = participantes.filter((p) => {
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
      <label class="campo"><span>Tipo *</span>
        <select class="select" name="tipo">${TIPOS.map((t) => `<option ${t === (p?.tipo || "Convidado") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="campo"><span>Ingresso</span><input class="input" name="ingresso" value="${esc(p?.ingresso || "")}" placeholder="Convite, GOLD…" /></label>
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
        tipo: f.tipo, ingresso: f.ingresso.trim() || null, faturamento: f.faturamento || null,
        pagamento: f.pagamento, quantidade: Number(f.quantidade) || 1, etapa_id: f.etapa_id || null,
      };
      if (p) reg.id = p.id;
      const salvo = await salvar("participantes", reg);
      await sincronizarAnfitriao(salvo, p);
      toast(p ? "Participante atualizado." : "Participante cadastrado.", "ok");
      await recarregar();
    },
  });
}

// Cria/vincula anfitrião quando tipo = Anfitrião; limpa vínculo quando sai disso.
async function sincronizarAnfitriao(salvo, anterior) {
  if (salvo.tipo === "Anfitrião" && !salvo.anfitriao_id) {
    const id = await resolverAnfitriao(salvo.nome, salvo.email, salvo.telefone);
    await salvar("participantes", { id: salvo.id, anfitriao_id: id });
  } else if (salvo.tipo !== "Anfitrião" && salvo.anfitriao_id) {
    await salvar("participantes", { id: salvo.id, anfitriao_id: null });
  }
}

async function resolverAnfitriao(nome, email, telefone) {
  anfitrioes = await listAnfitrioes().catch(() => anfitrioes);
  const e = (email || "").trim().toLowerCase();
  if (e) {
    const existe = anfitrioes.find((a) => (a.email || "").toLowerCase() === e);
    if (existe) return existe.id;
  }
  const novo = await salvar("anfitrioes", {
    nome, email: email || null, telefone: telefone || null,
    tipo: "Titular", estagio_id: estagios[0]?.id || null,
  });
  anfitrioes.push(novo);
  return novo.id;
}

async function recarregar() {
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
      <span class="badge ${badgePag(p.pagamento)}">${esc(p.pagamento)}</span>
      <span class="badge badge-neutro">${esc(nomeEtapa(p.etapa_id))}</span>
    </div>
    <div class="secao">
      <p style="margin:4px 0">${esc(p.email || "—")}</p>
      <p style="margin:4px 0">${esc(p.telefone || "—")}</p>
      <p class="pagina-sub" style="margin:4px 0">Cadastrado em ${formatarData(p.created_at, true)}</p>
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
    await remover("participantes", id);
    toast("Participante excluído.", "ok");
    fecharGaveta();
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

/* ---- Importar ---- */
const MODELO =
  "nome;email;telefone;tipo;ingresso;faturamento;pagamento;quantidade\n" +
  "Maria Silva;maria@ex.com;11999990000;Convidado;Convite;150 mil – 500 mil/mês;Gratuito;1\n" +
  "João Souza;joao@ex.com;11988887777;Anfitrião;Convite;;Gratuito;1";

function modalImportar() {
  abrirModal({
    titulo: "Importar participantes",
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole a tabela (Excel/Sheets) ou selecione um CSV. Colunas: <b>nome</b>
        (obrigatória), email, telefone, tipo, ingresso, faturamento, pagamento,
        quantidade. Quem vier com <b>tipo = Anfitrião</b> também entra na Gestão de
        anfitriões (sem duplicar, casando por e-mail).
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

      for (const l of validas) {
        l._tipo = normTipo(l.tipo) || "Convidado";
        l._anfitriao_id = l._tipo === "Anfitrião"
          ? await resolverAnfitriao(l.nome.trim(), (l.email || "").trim(), (l.telefone || "").trim())
          : null;
      }
      const registros = validas.map((l) => ({
        nome: l.nome.trim(),
        email: (l.email || "").trim() || null,
        telefone: (l.telefone || "").trim() || null,
        tipo: l._tipo,
        ingresso: (l.ingresso || "").trim() || null,
        faturamento: (l.faturamento || "").trim() || null,
        pagamento: normPag(l.pagamento) || "Gratuito",
        quantidade: Number(l.quantidade) || 1,
        etapa_id: etapas[0]?.id || null,
        anfitriao_id: l._anfitriao_id,
      }));
      await inserirLote("participantes", registros);
      const ign = linhas.length - validas.length;
      toast(`${registros.length} participante(s) importado(s).` + (ign ? ` ${ign} ignorada(s).` : ""), "ok");
      await recarregar();
    },
  });
}

/* ---- Exportar ---- */
function exportar() {
  const dados = filtrarLista();
  if (!dados.length) { toast("Nada para exportar com esses filtros.", "erro"); return; }
  const csv = gerarCSV(dados, [
    { chave: "nome", rotulo: "Nome" },
    { chave: "email", rotulo: "E-mail" },
    { chave: "telefone", rotulo: "Telefone" },
    { chave: "tipo", rotulo: "Tipo" },
    { chave: "ingresso", rotulo: "Ingresso" },
    { chave: "faturamento", rotulo: "Faturamento" },
    { chave: "pagamento", rotulo: "Pagamento" },
    { chave: "quantidade", rotulo: "Quantidade" },
    { rotulo: "Etapa", valor: (p) => nomeEtapa(p.etapa_id) },
    { rotulo: "Data de cadastro", valor: (p) => formatarData(p.created_at) },
  ]);
  baixarCSV("participantes.csv", csv);
  toast("Arquivo gerado.", "ok");
}
