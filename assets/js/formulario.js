// =============================================================================
// Editor do formulário de inscrição (perguntas do convite).
// =============================================================================
import { iniciarPagina, esc, slugify, abrirModal, toast, confirmar } from "./ui.js";
import { listFormPerguntas, salvar, remover } from "./supabase.js";
import { TIPOS_PERGUNTA } from "./config.js";

iniciarPagina("formulario");
const el = (id) => document.getElementById(id);
let perguntas = [];

carregar();

async function carregar() {
  try {
    perguntas = await listFormPerguntas();
    el("carregando").hidden = true;
    render();
  } catch (e) {
    el("carregando").textContent = "Erro ao carregar: " + e.message;
  }
}

el("btn-nova").onclick = () => editar(null);

function rotuloTipo(v) {
  return TIPOS_PERGUNTA.find((t) => t.valor === v)?.rotulo || v;
}

function render() {
  el("lista").innerHTML = perguntas
    .map((p, i) => {
      return `<div class="card" data-id="${p.id}" style="${p.ativo ? "" : "opacity:.55"}">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="display:flex;flex-direction:column;gap:2px">
            <button class="icone-btn" data-mover="-1" ${i === 0 ? "disabled" : ""}>▲</button>
            <button class="icone-btn" data-mover="1" ${i === perguntas.length - 1 ? "disabled" : ""}>▼</button>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(p.rotulo)}</div>
            <div class="pagina-sub" style="margin:4px 0 0;font-size:.78rem">
              <code>${esc(p.chave)}</code> · ${esc(rotuloTipo(p.tipo))}
              ${p.obrigatorio ? ' · <span class="badge badge-laranja">obrigatória</span>' : ""}
              ${p.sistema ? ' · <span class="badge badge-neutro">do sistema</span>' : ""}
              ${p.ativo ? "" : ' · <span class="badge badge-erro">inativa</span>'}
            </div>
            ${
              p.tipo === "selecao" && (p.opcoes || []).length
                ? `<div class="pagina-sub" style="margin:6px 0 0;font-size:.75rem">Opções: ${p.opcoes.map(esc).join(" · ")}</div>`
                : ""
            }
          </div>
          <div class="linha-acoes">
            <button class="icone-btn" data-toggle-ativo title="Ativar/desativar">${p.ativo ? "🚫" : "✔"}</button>
            <button class="icone-btn" data-editar title="Editar">✎</button>
            ${p.sistema ? "" : '<button class="icone-btn" data-excluir title="Excluir">🗑</button>'}
          </div>
        </div>
      </div>`;
    })
    .join("");

  el("lista").querySelectorAll("[data-id]").forEach((card) => {
    const p = perguntas.find((x) => x.id === card.dataset.id);
    card.querySelector("[data-editar]").onclick = () => editar(p);
    card.querySelectorAll("[data-mover]").forEach((b) => {
      b.onclick = () => mover(p, Number(b.dataset.mover));
    });
    card.querySelector("[data-toggle-ativo]").onclick = () => toggleAtivo(p);
    card.querySelector("[data-excluir]")?.addEventListener("click", () => excluir(p));
  });
}

async function mover(p, dir) {
  const i = perguntas.findIndex((x) => x.id === p.id);
  const j = i + dir;
  if (j < 0 || j >= perguntas.length) return;
  const a = perguntas[i], b = perguntas[j];
  try {
    await Promise.all([
      salvar("form_perguntas", { id: a.id, ordem: b.ordem }),
      salvar("form_perguntas", { id: b.id, ordem: a.ordem }),
    ]);
    perguntas = await listFormPerguntas();
    render();
  } catch (e) {
    toast(e.message, "erro");
  }
}

async function toggleAtivo(p) {
  try {
    await salvar("form_perguntas", { id: p.id, ativo: !p.ativo });
    p.ativo = !p.ativo;
    render();
  } catch (e) {
    toast(e.message, "erro");
  }
}

async function excluir(p) {
  if (p.sistema) return;
  if (!confirmar(`Excluir a pergunta "${p.rotulo}"?`)) return;
  try {
    await remover("form_perguntas", p.id);
    perguntas = perguntas.filter((x) => x.id !== p.id);
    render();
    toast("Pergunta excluída.", "ok");
  } catch (e) {
    toast(e.message, "erro");
  }
}

function editar(p) {
  const novo = !p;
  abrirModal({
    titulo: novo ? "Nova pergunta" : "Editar pergunta",
    corpoHtml: `
      <label class="campo"><span>Pergunta (rótulo) *</span>
        <input class="input" name="rotulo" required value="${esc(p?.rotulo || "")}" /></label>
      <label class="campo"><span>Chave ${p?.sistema ? "(travada — do sistema)" : ""}</span>
        <input class="input" name="chave" value="${esc(p?.chave || "")}" ${p?.sistema ? "readonly" : ""}
          placeholder="ex: instagram" /></label>
      <label class="campo"><span>Tipo</span>
        <select class="select" name="tipo">
          ${TIPOS_PERGUNTA.map((t) => `<option value="${t.valor}" ${t.valor === (p?.tipo || "texto") ? "selected" : ""}>${t.rotulo}</option>`).join("")}
        </select></label>
      <label class="campo" data-opcoes ${p?.tipo === "selecao" ? "" : "hidden"}>
        <span>Opções (uma por linha)</span>
        <textarea class="input" name="opcoes" rows="4">${esc((p?.opcoes || []).join("\n"))}</textarea></label>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" name="obrigatorio" ${p?.obrigatorio ?? true ? "checked" : ""} />
        <span style="margin:0">Resposta obrigatória</span></label>`,
    onConfirmar: async (form) => {
      const f = new FormData(form);
      const tipo = f.get("tipo");
      let chave = p?.sistema ? p.chave : (slugify(f.get("chave")) || slugify(f.get("rotulo")));
      if (!chave) { toast("Informe uma chave.", "erro"); return false; }
      if (novo && perguntas.some((x) => x.chave === chave)) {
        toast("Já existe uma pergunta com essa chave.", "erro");
        return false;
      }
      const registro = {
        rotulo: f.get("rotulo").trim(),
        chave,
        tipo,
        obrigatorio: f.get("obrigatorio") === "on",
        opcoes:
          tipo === "selecao"
            ? String(f.get("opcoes") || "").split("\n").map((s) => s.trim()).filter(Boolean)
            : [],
      };
      if (p) registro.id = p.id;
      else registro.ordem = (perguntas.at(-1)?.ordem || 0) + 1;
      await salvar("form_perguntas", registro);
      perguntas = await listFormPerguntas();
      render();
      toast("Pergunta salva.", "ok");
    },
    aoMontar: (root) => {
      const sel = root.querySelector('[name="tipo"]');
      const box = root.querySelector("[data-opcoes]");
      sel.onchange = () => { box.hidden = sel.value !== "selecao"; };
    },
  });
}
