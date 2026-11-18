// =============================================================================
// Observações como histórico: cada uma é um registro com autor, data e hora,
// e pode ser editada ou excluída (migração 0044).
//
//   montarObservacoes(caixa, { tipo: "participante", id, tabela: "participantes", legado: p.observacao })
//
// O autor e a data são definidos pelo banco (não dá para forjar). Editar/excluir
// vale para quem escreveu e para admins da organização — o banco confirma.
// Sem a migração 0044, cai no modo antigo (um único campo de texto) pra não
// quebrar a tela.
// =============================================================================
import { esc, formatarData, toast, confirmar, icone } from "./ui.js";
import { listObservacoes, salvar, remover } from "./supabase.js";
import { contexto } from "./auth.js";

const SEM_TABELA = /observacoes|schema cache|does not exist|relation/i;

export async function montarObservacoes(caixa, { tipo, id, tabela, legado = "", aoMudar } = {}) {
  if (!caixa || !id) return;
  caixa.innerHTML = `<p class="pagina-sub" style="margin:0">Carregando…</p>`;
  const ctx = await contexto().catch(() => null);
  let itens;
  try {
    itens = await listObservacoes(tipo, id);
  } catch (e) {
    if (SEM_TABELA.test(e?.message || "")) { modoAntigo(caixa, { id, tabela, legado }); return; }
    caixa.innerHTML = `<p class="pagina-sub" style="margin:0">Erro ao carregar observações: ${esc(e.message)}</p>`;
    return;
  }

  const pode = (n) => !!ctx && (ctx.superAdmin || ctx.papel === "admin" || (!!n.autor_id && n.autor_id === ctx.user?.id));
  let editando = null;   // id da observação em edição

  const quando = (n) => {
    const base = formatarData(n.created_at, true);
    return n.editado_em
      ? `${base} · <span title="${esc(formatarData(n.editado_em, true))}">editado${n.editado_por_nome ? ` por ${esc(n.editado_por_nome)}` : ""} em ${esc(formatarData(n.editado_em, true))}</span>`
      : base;
  };

  function itemHtml(n) {
    const cab = `<div class="obs-cab">
        <span class="obs-autor">${esc(n.autor_nome || "—")}</span>
        <span class="obs-quando">${quando(n)}</span>
        ${pode(n) && editando !== n.id ? `<span class="obs-acoes">
          <button type="button" class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
          <button type="button" class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
        </span>` : ""}
      </div>`;
    if (editando === n.id) {
      return `<div class="obs-item" data-id="${n.id}">${cab}
        <textarea class="input" rows="3" data-texto>${esc(n.texto)}</textarea>
        <div class="obs-botoes">
          <button type="button" class="btn btn-primario btn-sm" data-salvar>Salvar</button>
          <button type="button" class="btn btn-secundario btn-sm" data-cancelar>Cancelar</button>
        </div></div>`;
    }
    return `<div class="obs-item" data-id="${n.id}">${cab}<div class="obs-texto">${esc(n.texto)}</div></div>`;
  }

  function desenha() {
    caixa.innerHTML = `
      <div class="obs">
        <textarea class="input" rows="3" data-novo placeholder="Escreva uma observação… (Ctrl+Enter para adicionar)"></textarea>
        <button type="button" class="btn btn-secundario" data-adicionar style="margin-top:8px">Adicionar observação</button>
        <div class="obs-lista">${itens.length
          ? itens.map(itemHtml).join("")
          : `<p class="pagina-sub" style="margin:10px 0 0">Nenhuma observação ainda.</p>`}</div>
      </div>`;
    const novo = caixa.querySelector("[data-novo]");
    const adicionar = async () => {
      const texto = novo.value.trim();
      if (!texto) { toast("Escreva a observação antes de adicionar.", "erro"); novo.focus(); return; }
      const btn = caixa.querySelector("[data-adicionar]");
      btn.disabled = true;
      try {
        await salvar("observacoes", { registro_tipo: tipo, registro_id: id, texto });
        itens = await listObservacoes(tipo, id);
        editando = null;
        toast("Observação adicionada.", "ok");
        desenha();
        aoMudar?.(itens);
      } catch (e) {
        toast(e.message, "erro");
        btn.disabled = false;
      }
    };
    caixa.querySelector("[data-adicionar]").onclick = adicionar;
    novo.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); adicionar(); } });

    caixa.querySelectorAll(".obs-item").forEach((el) => {
      const nid = el.dataset.id;
      const n = itens.find((x) => x.id === nid);
      el.querySelector("[data-editar]")?.addEventListener("click", () => {
        editando = nid; desenha();
        caixa.querySelector(`.obs-item[data-id="${nid}"] [data-texto]`)?.focus();
      });
      el.querySelector("[data-cancelar]")?.addEventListener("click", () => { editando = null; desenha(); });
      el.querySelector("[data-salvar]")?.addEventListener("click", async () => {
        const texto = el.querySelector("[data-texto]").value.trim();
        if (!texto) { toast("A observação não pode ficar vazia (use a lixeira para excluir).", "erro"); return; }
        if (texto === n.texto) { editando = null; desenha(); return; }
        try {
          await salvar("observacoes", { id: nid, texto });
          itens = await listObservacoes(tipo, id);
          editando = null;
          toast("Observação atualizada.", "ok");
          desenha();
          aoMudar?.(itens);
        } catch (e) {
          toast(/no rows|0 rows|multiple \(or no\)/i.test(e.message || "") ? "Você não tem permissão para editar esta observação." : e.message, "erro");
        }
      });
      el.querySelector("[data-excluir]")?.addEventListener("click", async () => {
        if (!confirmar("Excluir esta observação? Não dá para desfazer.")) return;
        try {
          const apagadas = await remover("observacoes", nid);
          if (!apagadas?.length) { toast("Você não tem permissão para excluir esta observação.", "erro"); return; }
          itens = itens.filter((x) => x.id !== nid);
          toast("Observação excluída.", "ok");
          desenha();
          aoMudar?.(itens);
        } catch (e) { toast(e.message, "erro"); }
      });
    });
  }
  desenha();
}

// Banco sem a migração 0044: mantém o campo único de antes
function modoAntigo(caixa, { id, tabela, legado }) {
  caixa.innerHTML = `
    <textarea class="input" rows="3" data-legado>${esc(legado || "")}</textarea>
    <button type="button" class="btn btn-secundario" data-salvar-legado style="margin-top:8px">Salvar observação</button>
    <p class="pagina-sub" style="margin:8px 0 0;font-size:.74rem">Para ter o histórico (quem escreveu, data e hora, editar e excluir), rode a migração <code>0044_observacoes.sql</code> no SQL Editor do Supabase.</p>`;
  caixa.querySelector("[data-salvar-legado]").onclick = async () => {
    try {
      await salvar(tabela, { id, observacao: caixa.querySelector("[data-legado]").value.trim() || null });
      toast("Observação salva.", "ok");
    } catch (e) { toast(e.message, "erro"); }
  };
}
