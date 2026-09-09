// =============================================================================
// Configurações — geral + CRUD de grupos, responsáveis e estágios.
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast, confirmar } from "./ui.js";
import {
  listGrupos, listResponsaveis, listEstagios, getConfig,
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
    form.nome_produto.value = config.nome_produto || "";
    form.meta_confirmados.value = config.meta_confirmados ?? 0;
    form.subtitulo_convite.value = config.subtitulo_convite || "";
    form.texto_confirmacao.value = config.texto_confirmacao || "";
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await salvarConfig({
          nome_produto: form.nome_produto.value.trim(),
          meta_confirmados: Number(form.meta_confirmados.value) || 0,
          subtitulo_convite: form.subtitulo_convite.value.trim() || null,
          texto_confirmacao: form.texto_confirmacao.value.trim() || null,
        });
        toast("Configurações salvas.", "ok");
      } catch (err) {
        toast(err.message, "erro");
      }
    };

    el("conteudo").querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = () => editarItem(b.dataset.add, null);
    });

    el("carregando").hidden = true;
    el("conteudo").hidden = false;
    await Promise.all([renderGrupos(), renderResponsaveis(), renderEstagios()]);
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
