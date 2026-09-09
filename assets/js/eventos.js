// =============================================================================
// Tela de escolha de evento — abrir um existente ou criar um novo.
// Não usa iniciarPagina (não exige evento selecionado).
// =============================================================================
import { esc, formatarData, abrirModal, toast, icone } from "./ui.js";
import { listEventos, criarEvento } from "./supabase.js";
import { definirEvento, eventoId } from "./evento.js";

const el = (id) => document.getElementById(id);

el("btn-criar").innerHTML = icone("mais") + "Criar evento";
el("btn-criar").onclick = modalCriar;

carregar();

async function carregar() {
  try {
    const eventos = await listEventos();
    el("carregando").hidden = true;
    el("btn-criar").hidden = false;
    if (!eventos.length) { el("vazio").hidden = false; return; }
    el("lista").hidden = false;
    renderLista(eventos);
  } catch (e) {
    const falta = /eventos|criar_evento|schema cache/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0005_eventos.sql</code> no SQL Editor do Supabase para ativar os eventos.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

function renderLista(eventos) {
  const atual = eventoId();
  el("lista").innerHTML = eventos
    .map((e) => {
      const partes = [
        e.data_evento ? formatarData(e.data_evento) : null,
        e.local || null,
      ].filter(Boolean).join(" · ");
      return `<button class="evento-card ${e.id === atual ? "atual" : ""}" data-id="${esc(e.id)}" data-nome="${esc(e.nome)}">
        <span class="evento-card-nome">${esc(e.nome)}</span>
        <span class="evento-card-info">${esc(partes || "sem data definida")}</span>
        ${e.id === atual ? '<span class="badge badge-laranja">aberto agora</span>' : ""}
      </button>`;
    })
    .join("");
  el("lista").querySelectorAll(".evento-card").forEach((c) => {
    c.onclick = () => {
      definirEvento(c.dataset.id, c.dataset.nome);
      location.href = "index.html";
    };
  });
}

function modalCriar() {
  abrirModal({
    titulo: "Criar evento",
    textoConfirmar: "Criar e abrir",
    corpoHtml: `
      <label class="campo"><span>Nome do evento *</span>
        <input class="input" name="nome" required placeholder="Ex: Imersão São Paulo — Março/2026" /></label>
      <label class="campo"><span>Data</span>
        <input class="input" name="data_evento" type="date" /></label>
      <label class="campo"><span>Local</span>
        <input class="input" name="local" placeholder="Ex: Alphaville, São Paulo" /></label>
      <p class="pagina-sub" style="margin:2px 0 0;font-size:.8rem">
        O evento nasce com as etapas, perguntas e marcos padrão — você ajusta tudo depois em Configurações.
      </p>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const id = await criarEvento(f.nome.trim(), f.data_evento || null, f.local.trim() || null);
      definirEvento(id, f.nome.trim());
      toast("Evento criado.", "ok");
      location.href = "index.html";
    },
  });
}
