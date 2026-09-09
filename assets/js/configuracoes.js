// =============================================================================
// Configurações — geral + CRUD de grupos, responsáveis e estágios.
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast, confirmar } from "./ui.js";
import {
  listGrupos, listResponsaveis, listEstagios, listMarcos, getConfig,
  salvar, remover, salvarConfig,
} from "./supabase.js";

iniciarPagina("config");
const el = (id) => document.getElementById(id);

let config = null;

carregar();

async function carregar() {
  try {
    config = await getConfig();
    const form = el("form-config");
    const campos = ["nome_produto", "subtitulo_convite", "texto_confirmacao",
      "texto_em_analise", "texto_aprovado", "texto_recusado"];
    campos.forEach((k) => { if (form[k]) form[k].value = config[k] || ""; });
    form.meta_confirmados.value = config.meta_confirmados ?? 0;
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const patch = { meta_confirmados: Number(form.meta_confirmados.value) || 0 };
        // só envia colunas que existem (as de texto_* dependem da migração 0003)
        campos.forEach((k) => {
          if (form[k] && k in config) patch[k] = form[k].value.trim() || null;
        });
        await salvarConfig(patch);
        toast("Configurações salvas.", "ok");
      } catch (err) {
        toast(err.message, "erro");
      }
    };

    el("conteudo").querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = () => editarItem(b.dataset.add, null);
    });
    el("add-marco").onclick = () => editarMarco(null);

    el("carregando").hidden = true;
    el("conteudo").hidden = false;
    await Promise.all([renderGrupos(), renderResponsaveis(), renderEstagios(), renderMarcos()]);
  } catch (e) {
    el("carregando").textContent = "Erro ao carregar: " + e.message;
  }
}

/* ---- listas ---- */
function itemLinha(tabela, x, extra = "") {
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--cinza-100)" data-id="${x.id}">
    <span style="font-size:.9rem">${esc(x.nome)}${extra}</span>
    <span class="linha-acoes">
      <button class="icone-btn" data-editar>✎</button>
      <button class="icone-btn" data-excluir>🗑</button>
    </span>
  </div>`;
}

function ligar(container, tabela, recarregar) {
  container.querySelectorAll("[data-id]").forEach((row) => {
    row.querySelector("[data-editar]").onclick = () => editarItem(tabela, row.dataset.id, recarregar);
    row.querySelector("[data-excluir]").onclick = async () => {
      if (!confirmar("Excluir este item?")) return;
      try {
        await remover(tabela, row.dataset.id);
        toast("Item excluído.", "ok");
        recarregar();
      } catch (e) { toast(e.message, "erro"); }
    };
  });
}

async function renderGrupos() {
  const arr = await listGrupos();
  const c = el("lista-grupos");
  c.innerHTML = arr.length ? arr.map((x) => itemLinha("grupos", x)).join("") : vazio();
  ligar(c, "grupos", renderGrupos);
}
async function renderResponsaveis() {
  const arr = await listResponsaveis();
  const c = el("lista-responsaveis");
  c.innerHTML = arr.length ? arr.map((x) => itemLinha("responsaveis", x)).join("") : vazio();
  ligar(c, "responsaveis", renderResponsaveis);
}
async function renderEstagios() {
  const arr = await listEstagios();
  const c = el("lista-estagios");
  c.innerHTML = arr.length
    ? arr.map((x) => itemLinha("estagios", x, ` <span class="pagina-sub" style="font-size:.72rem">ordem ${x.ordem}</span>`)).join("")
    : vazio();
  ligar(c, "estagios", renderEstagios);
}

const vazio = () => `<p class="pagina-sub" style="margin:0">Nada cadastrado ainda.</p>`;

/* ---- Marcos / Prêmios ---- */
async function renderMarcos() {
  const arr = await listMarcos();
  const c = el("lista-marcos");
  c.innerHTML = arr.length
    ? arr
        .map(
          (m) => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:11px 0;border-bottom:1px solid var(--cinza-100)" data-id="${m.id}">
        <div>
          <div style="font-weight:600;font-size:.9rem">
            <span class="badge badge-laranja" style="margin-right:6px">${m.quantidade} confirmados</span>${esc(m.titulo)}
          </div>
          <div class="pagina-sub" style="margin:3px 0 0;font-size:.8rem">${esc(m.descricao || "—")}</div>
        </div>
        <span class="linha-acoes">
          <button class="icone-btn" data-editar>✎</button>
          <button class="icone-btn" data-excluir>🗑</button>
        </span>
      </div>`
        )
        .join("")
    : vazio();
  c.querySelectorAll("[data-id]").forEach((row) => {
    const m = arr.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-editar]").onclick = () => editarMarco(m);
    row.querySelector("[data-excluir]").onclick = async () => {
      if (!confirmar(`Excluir o marco "${m.titulo}"?`)) return;
      try {
        await remover("marcos", m.id);
        toast("Marco excluído.", "ok");
        renderMarcos();
      } catch (e) { toast(e.message, "erro"); }
    };
  });
}

function editarMarco(m) {
  abrirModal({
    titulo: m ? "Editar marco" : "Novo marco",
    corpoHtml: `
      <label class="campo"><span>Convidados confirmados para desbloquear *</span>
        <input class="input" name="quantidade" type="number" min="1" required value="${m?.quantidade ?? ""}" /></label>
      <label class="campo"><span>Título *</span>
        <input class="input" name="titulo" required value="${esc(m?.titulo || "")}" /></label>
      <label class="campo"><span>Descrição / prêmio</span>
        <textarea class="input" name="descricao" rows="2">${esc(m?.descricao || "")}</textarea></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const registro = {
        quantidade: Number(f.quantidade) || 1,
        titulo: f.titulo.trim(),
        descricao: f.descricao.trim() || null,
        ordem: Number(f.quantidade) || 1,
      };
      if (m) registro.id = m.id;
      await salvar("marcos", registro);
      toast("Marco salvo.", "ok");
      renderMarcos();
    },
  });
}

/* ---- editar / criar ---- */
const RECARGA = { grupos: renderGrupos, responsaveis: renderResponsaveis, estagios: renderEstagios };
const TITULO = { grupos: "grupo", responsaveis: "responsável", estagios: "estágio" };

async function editarItem(tabela, id, recarregar) {
  recarregar = recarregar || RECARGA[tabela];
  let atual = null;
  if (id) {
    const fn = { grupos: listGrupos, responsaveis: listResponsaveis, estagios: listEstagios }[tabela];
    atual = (await fn()).find((x) => x.id === id);
  }
  abrirModal({
    titulo: (id ? "Editar " : "Novo ") + TITULO[tabela],
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(atual?.nome || "")}" /></label>
      ${
        tabela === "estagios"
          ? `<label class="campo"><span>Ordem</span>
               <input class="input" type="number" name="ordem" value="${atual?.ordem ?? ""}" /></label>
             <label class="campo"><span>Cor (hex, opcional)</span>
               <input class="input" name="cor" value="${esc(atual?.cor || "")}" placeholder="#ea580c" /></label>`
          : ""
      }`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const registro = { nome: f.nome.trim() };
      if (tabela === "estagios") {
        registro.ordem = Number(f.ordem) || 0;
        registro.cor = f.cor || null;
      }
      if (id) registro.id = id;
      await salvar(tabela, registro);
      toast("Salvo.", "ok");
      recarregar();
    },
  });
}
