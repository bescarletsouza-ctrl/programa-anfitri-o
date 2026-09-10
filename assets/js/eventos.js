// =============================================================================
// Tela de escolha de evento — abrir, criar, editar ou excluir um evento.
// Não usa iniciarPagina (não exige evento selecionado).
// =============================================================================
import { esc, formatarData, abrirModal, toast, icone } from "./ui.js";
import { listEventos, criarEvento, salvarEventoPorId, excluirEvento, listarOrgs } from "./supabase.js";
import { definirEvento, eventoId, sairEvento } from "./evento.js";
import { exigirLogin, contexto, sair, planoBloqueado } from "./auth.js";

const el = (id) => document.getElementById(id);
let CTX = null;

el("btn-criar").innerHTML = icone("mais") + "Criar evento";
el("btn-criar").onclick = modalCriar;

(async function () {
  if (!(await exigirLogin())) return;
  CTX = await contexto();
  if (el("eventos-sair")) el("eventos-sair").onclick = sair;
  carregar();
})();

async function carregar() {
  try {
    const eventos = await listEventos();
    el("carregando").hidden = true;
    el("btn-criar").hidden = false;
    el("vazio").hidden = eventos.length > 0;
    el("lista").hidden = eventos.length === 0;
    renderLista(eventos);
  } catch (e) {
    const falta = /eventos|criar_evento|schema cache/.test(e.message || "");
    el("carregando").hidden = false;
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
      return `<div class="evento-card ${e.id === atual ? "atual" : ""}">
        <button class="evento-card-abrir" data-abrir data-id="${esc(e.id)}" data-nome="${esc(e.nome)}">
          <span class="evento-card-nome">${esc(e.nome)}</span>
          <span class="evento-card-info">${esc(partes || "sem data definida")}</span>
          ${e.id === atual ? '<span class="badge badge-laranja">aberto agora</span>' : ""}
        </button>
        <div class="evento-card-acoes">
          <button class="icone-btn" data-editar="${esc(e.id)}" title="Editar evento" aria-label="Editar evento">${icone("editar")}</button>
          <button class="icone-btn" data-excluir="${esc(e.id)}" title="Excluir evento" aria-label="Excluir evento">${icone("excluir")}</button>
        </div>
      </div>`;
    })
    .join("");

  el("lista").querySelectorAll("[data-abrir]").forEach((c) => {
    c.onclick = () => {
      definirEvento(c.dataset.id, c.dataset.nome);
      location.href = "index.html";
    };
  });
  el("lista").querySelectorAll("[data-editar]").forEach((b) => {
    b.onclick = () => modalEditar(eventos.find((e) => e.id === b.dataset.editar));
  });
  el("lista").querySelectorAll("[data-excluir]").forEach((b) => {
    b.onclick = () => modalExcluir(eventos.find((e) => e.id === b.dataset.excluir));
  });
}

const camposHtml = (e = {}) => `
  <label class="campo"><span>Nome do evento *</span>
    <input class="input" name="nome" required value="${esc(e.nome || "")}"
      placeholder="Ex: Imersão São Paulo — Março/2026" /></label>
  <label class="campo"><span>Data</span>
    <input class="input" name="data_evento" type="date" value="${esc(e.data_evento || "")}" /></label>
  <label class="campo"><span>Local</span>
    <input class="input" name="local" value="${esc(e.local || "")}"
      placeholder="Ex: Alphaville, São Paulo" /></label>`;

async function modalCriar() {
  const bloqueio = planoBloqueado(CTX);
  if (bloqueio) { toast(bloqueio, "erro"); return; }

  let orgsSuper = null;
  if (CTX?.superAdmin) {
    orgsSuper = await listarOrgs().catch(() => []);
  }
  const orgSelHtml = orgsSuper
    ? `<label class="campo"><span>Organização *</span>
        <select class="select" name="org_id" required>
          ${orgsSuper.map((o) => `<option value="${esc(o.id)}">${esc(o.nome)}${o.max_eventos ? ` (${o.eventos_usados}/${o.max_eventos})` : ""}</option>`).join("")}
        </select></label>`
    : "";

  abrirModal({
    titulo: "Criar evento",
    textoConfirmar: "Criar e abrir",
    corpoHtml: orgSelHtml + camposHtml() + `
      <p class="pagina-sub" style="margin:2px 0 0;font-size:.8rem">
        O evento nasce com as etapas, perguntas e marcos padrão — você ajusta tudo depois em Configurações.
      </p>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const orgId = f.org_id || CTX?.org?.id || null;
      if (!orgId) { toast("Sem organização vinculada à sua conta.", "erro"); return false; }
      const id = await criarEvento(f.nome.trim(), orgId, f.data_evento || null, f.local.trim() || null);
      definirEvento(id, f.nome.trim());
      toast("Evento criado.", "ok");
      location.href = "index.html";
    },
  });
}

function modalEditar(e) {
  if (!e) return;
  abrirModal({
    titulo: "Editar evento",
    textoConfirmar: "Salvar",
    corpoHtml: camposHtml(e),
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const nome = f.nome.trim();
      await salvarEventoPorId(e.id, {
        nome,
        data_evento: f.data_evento || null,
        local: f.local.trim() || null,
      });
      if (eventoId() === e.id) definirEvento(e.id, nome); // atualiza o rótulo no menu
      toast("Evento atualizado.", "ok");
      carregar();
    },
  });
}

function modalExcluir(e) {
  if (!e) return;
  abrirModal({
    titulo: "Excluir evento",
    textoConfirmar: "Excluir definitivamente",
    corpoHtml: `
      <div class="aviso" style="margin:0 0 14px">
        Isto apaga <b>tudo</b> do evento “${esc(e.nome)}”: anfitriões, convidados,
        participantes, check-ins, atividades, tipos de ingresso e configurações.
        Não dá para desfazer.
      </div>
      <label class="campo"><span>Para confirmar, digite o nome do evento</span>
        <input class="input" name="confirmacao" autocomplete="off" placeholder="${esc(e.nome)}" /></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      if ((f.confirmacao || "").trim() !== e.nome.trim()) {
        toast("O nome não confere.", "erro");
        return false;
      }
      await excluirEvento(e.id);
      if (eventoId() === e.id) sairEvento();
      toast("Evento excluído.", "ok");
      carregar();
    },
  });
}
