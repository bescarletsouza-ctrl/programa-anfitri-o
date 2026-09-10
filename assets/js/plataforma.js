// =============================================================================
// Painel da plataforma — só a super-admin. Cadastra organizações (clientes),
// define limites (nº de eventos + expiração) e nível de acesso, e gerencia os
// usuários de cada organização. Tudo via a Edge Function "plataforma".
// =============================================================================
import { iniciarPagina, esc, formatarData, abrirModal, toast, confirmar, icone } from "./ui.js";
import { listarOrgs, criarOrg, editarOrg, removerOrg, addMembroOrg, removerMembroOrg } from "./supabase.js";

const el = (id) => document.getElementById(id);
let orgs = [];

const _iniciando = iniciarPagina("plataforma");
_iniciando.then((ctx) => { if (ctx) carregar(); });
el("btn-nova").onclick = () => modalOrg(null);

const ACESSOS = { tudo: "Tudo", eventos: "Só eventos", anfitrioes: "Só anfitriões" };
const hoje = () => new Date().toISOString().slice(0, 10);

function status(o) {
  if (!o.ativo) return { txt: "Inativa", cls: "badge-erro" };
  if (o.expira_em && o.expira_em < hoje()) return { txt: "Expirada", cls: "badge-erro" };
  if (o.expira_em) {
    const dias = Math.round((new Date(o.expira_em) - new Date(hoje())) / 86400000);
    if (dias <= 7) return { txt: `${dias}d p/ expirar`, cls: "badge-alerta" };
  }
  return { txt: "Ativa", cls: "badge-ok" };
}

async function carregar() {
  try {
    orgs = await listarOrgs();
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /deploy/.test(e.message)
      ? "Faça o deploy de <code>supabase/functions/plataforma</code> para usar esta tela."
      : "Erro: " + esc(e.message);
  }
}

function render() {
  const totalEventos = orgs.reduce((s, o) => s + (o.eventos_usados || 0), 0);
  const ativas = orgs.filter((o) => o.ativo && (!o.expira_em || o.expira_em >= hoje())).length;
  const kpi = (v, r) => `<div class="card"><div class="kpi"><span class="valor">${v}</span><span class="rotulo">${esc(r)}</span></div></div>`;
  el("kpis").innerHTML =
    kpi(orgs.length, "Organizações") + kpi(ativas, "Ativas") +
    kpi(orgs.reduce((s, o) => s + (o.membros || 0), 0), "Usuários") + kpi(totalEventos, "Eventos criados");

  el("vazio").hidden = orgs.length > 0;
  el("linhas").innerHTML = orgs.map((o) => {
    const st = status(o);
    const lim = o.max_eventos ? `${o.eventos_usados}/${o.max_eventos}` : `${o.eventos_usados}`;
    return `<tr data-id="${esc(o.id)}">
      <td><strong>${esc(o.nome)}</strong>${o.email ? `<div class="cel-tenue" style="font-size:.75rem">${esc(o.email)}</div>` : ""}</td>
      <td>${esc(o.ramo || "—")}</td>
      <td>${esc(ACESSOS[o.acesso] || o.acesso)}</td>
      <td class="num">${o.membros || 0}</td>
      <td class="num">${lim}</td>
      <td>${o.expira_em ? esc(o.expira_em.split("-").reverse().join("/")) : "sem prazo"}</td>
      <td><span class="badge ${st.cls}">${st.txt}</span></td>
      <td><span class="linha-acoes">
        <button class="btn btn-secundario btn-sm" data-membros>Usuários</button>
        <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
        <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
      </span></td>
    </tr>`;
  }).join("");

  el("linhas").querySelectorAll("tr[data-id]").forEach((row) => {
    const o = orgs.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-editar]").onclick = () => modalOrg(o);
    row.querySelector("[data-membros]").onclick = () => modalMembros(o);
    row.querySelector("[data-excluir]").onclick = () => modalExcluir(o);
  });
}

const campoNum = (rot, name, val) =>
  `<label class="campo"><span>${rot}</span><input class="input" name="${name}" type="number" min="0" value="${val ?? ""}" placeholder="vazio = sem limite" /></label>`;

function modalOrg(o) {
  const novo = !o;
  abrirModal({
    titulo: novo ? "Nova organização" : `Editar — ${o.nome}`,
    textoConfirmar: novo ? "Criar e convidar" : "Salvar",
    corpoHtml: `
      <label class="campo"><span>Empresa *</span><input class="input" name="nome" required value="${esc(o?.nome || "")}" /></label>
      <label class="campo"><span>Ramo de atuação</span><input class="input" name="ramo" value="${esc(o?.ramo || "")}" /></label>
      <label class="campo"><span>Faturamento</span><input class="input" name="faturamento" value="${esc(o?.faturamento || "")}" placeholder="faixa ou valor" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" value="${esc(o?.telefone || "")}" /></label>
      ${novo ? `
        <hr class="cfg-sep" />
        <label class="campo"><span>Nome do responsável</span><input class="input" name="responsavel_nome" /></label>
        <label class="campo"><span>E-mail do responsável *</span><input class="input" name="email" type="email" required placeholder="ele recebe o convite" /></label>
      ` : `<label class="campo"><span>E-mail de contato</span><input class="input" name="email" type="email" value="${esc(o?.email || "")}" /></label>`}
      <hr class="cfg-sep" />
      <label class="campo"><span>Nível de acesso</span>
        <select class="select" name="acesso">
          ${Object.entries(ACESSOS).map(([k, v]) => `<option value="${k}" ${k === (o?.acesso || "tudo") ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
      ${campoNum("Máximo de eventos", "max_eventos", o?.max_eventos)}
      <label class="campo"><span>Expira em</span><input class="input" name="expira_em" type="date" value="${esc(o?.expira_em || "")}" /></label>
      ${novo ? "" : `<label class="campo" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ativo" ${o.ativo ? "checked" : ""} /> <span style="margin:0">Organização ativa</span></label>`}`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const dados = {
        nome: f.nome.trim(), empresa: f.nome.trim(), ramo: f.ramo || null,
        faturamento: f.faturamento || null, telefone: f.telefone || null, email: (f.email || "").trim() || null,
        acesso: f.acesso, max_eventos: f.max_eventos || null, expira_em: f.expira_em || null,
      };
      if (novo) {
        if (!dados.email) { toast("E-mail do responsável é obrigatório.", "erro"); return false; }
        const r = await criarOrg({ ...dados, responsavel_nome: f.responsavel_nome || null });
        if (r.convite?.enviado) {
          toast("Organização criada e convite enviado por e-mail.", "ok");
        } else if (r.convite?.link) {
          mostrarLinkConvite(r.convite.link, dados.email);
        } else {
          toast("Organização criada.", "ok");
        }
      } else {
        await editarOrg(o.id, { ...dados, ativo: !!f.ativo });
        toast("Organização atualizada.", "ok");
      }
      carregar();
    },
  });
}

function mostrarLinkConvite(link, email) {
  abrirModal({
    titulo: "Convite gerado",
    textoConfirmar: "Copiar e fechar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">Ainda sem e-mail configurado. Envie este link para <b>${esc(email)}</b> definir a senha:</p>
      <label class="campo"><span>Link de acesso</span>
        <input class="input" id="lc" readonly value="${esc(link)}" onclick="this.select()" /></label>`,
    aoMontar: (root) => { root.querySelector("#lc").select?.(); },
    onConfirmar: async () => {
      try { await navigator.clipboard.writeText(link); toast("Link copiado.", "ok"); } catch {}
    },
  });
}

function modalExcluir(o) {
  abrirModal({
    titulo: "Excluir organização",
    textoConfirmar: "Excluir definitivamente",
    corpoHtml: `
      <div class="aviso aviso-erro" style="margin:0 0 14px">
        Apaga <b>tudo</b> de “${esc(o.nome)}”: eventos, participantes, anfitriões,
        check-ins e usuários. Não dá para desfazer.
      </div>
      <label class="campo"><span>Digite o nome da empresa para confirmar</span>
        <input class="input" name="c" autocomplete="off" placeholder="${esc(o.nome)}" /></label>`,
    onConfirmar: async (form) => {
      if ((new FormData(form).get("c") || "").trim() !== o.nome.trim()) { toast("O nome não confere.", "erro"); return false; }
      await removerOrg(o.id);
      toast("Organização excluída.", "ok");
      carregar();
    },
  });
}

function modalMembros(o) {
  const linha = (m) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--cinza-100)" data-mid="${esc(m.id)}">
    <div style="min-width:0">
      <div style="font-size:.88rem;font-weight:600">${esc(m.email || m.nome || "—")}</div>
      <div class="cel-tenue" style="font-size:.72rem">${m.papel === "admin" ? "admin" : "membro"}</div>
    </div>
    <button class="icone-btn" data-rm title="Remover">${icone("excluir")}</button>
  </div>`;
  abrirModal({
    titulo: `Usuários — ${o.nome}`,
    textoConfirmar: "Fechar",
    corpoHtml: `
      <div id="mlista">${(o.equipe || []).map(linha).join("") || `<p class="pagina-sub" style="margin:0">Só o responsável por enquanto.</p>`}</div>
      <hr class="cfg-sep" />
      <label class="campo"><span>Adicionar por e-mail</span><input class="input" id="m-email" type="email" placeholder="pessoa@email.com" /></label>
      <label class="campo"><span>Papel</span><select class="select" id="m-papel"><option value="membro">Membro</option><option value="admin">Admin</option></select></label>
      <button class="btn btn-secundario btn-sm" id="m-add" type="button">Enviar convite</button>`,
    aoMontar: (root) => {
      root.querySelector("#m-add").onclick = async () => {
        const email = root.querySelector("#m-email").value.trim();
        if (!email) return;
        try {
          await addMembroOrg(o.id, { email, papel: root.querySelector("#m-papel").value });
          toast("Convite enviado.", "ok");
          root.closest(".modal-fundo")?.remove();
          carregar();
        } catch (e) { toast(e.message, "erro"); }
      };
      root.querySelectorAll("[data-mid]").forEach((r) => {
        r.querySelector("[data-rm]").onclick = async () => {
          if (!confirmar("Remover este usuário?")) return;
          try { await removerMembroOrg(r.dataset.mid); r.remove(); carregar(); }
          catch (e) { toast(e.message, "erro"); }
        };
      });
    },
    onConfirmar: () => {},
  });
}
