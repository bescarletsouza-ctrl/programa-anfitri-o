// =============================================================================
// Configurações — geral + CRUD de grupos, responsáveis e estágios.
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast, confirmar, icone, formatarData } from "./ui.js";
import {
  listGrupos, listResponsaveis, listEstagios, listEtapasParticipante, listMarcos, listTiposIngresso,
  getEvento, salvar, remover, salvarEvento,
  listarEquipe, criarMembroEquipe, trocarSenhaMembro, removerMembroEquipe,
} from "./supabase.js";
import { eventoId, definirEvento } from "./evento.js";
import { montarCrachaHtml, CRACHA_PADRAO, TAMANHOS_CRACHA, snapTamanho, qrDataURL } from "./cracha.js";

const _iniciando = iniciarPagina("config");
const el = (id) => document.getElementById(id);

let config = null;
let CTX = null;

// Blocos recolhíveis — lembra quais o usuário fechou.
const BLOCOS_KEY = "cfg_blocos_recolhidos";
(function restaurarBlocos() {
  let fechados = [];
  try { fechados = JSON.parse(localStorage.getItem(BLOCOS_KEY) || "[]"); } catch {}
  document.querySelectorAll(".cfg-bloco[data-bloco]").forEach((d) => {
    if (fechados.includes(d.dataset.bloco)) d.open = false;
    d.addEventListener("toggle", () => {
      const agora = [...document.querySelectorAll(".cfg-bloco[data-bloco]")]
        .filter((x) => !x.open).map((x) => x.dataset.bloco);
      try { localStorage.setItem(BLOCOS_KEY, JSON.stringify(agora)); } catch {}
    });
  });
})();

_iniciando.then((ctx) => { if (ctx) { CTX = ctx; carregar(ctx); } });

async function carregar() {
  try {
    config = await getEvento(eventoId());
    const form = el("form-config");
    const textos = ["nome", "local", "subtitulo_convite", "texto_confirmacao",
      "texto_em_analise", "texto_aprovado", "texto_recusado"];
    textos.forEach((k) => { if (form[k]) form[k].value = config[k] || ""; });
    if (form.data_evento) form.data_evento.value = config.data_evento || "";
    form.meta_confirmados.value = config.meta_confirmados ?? 0;
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const patch = {
          nome: form.nome.value.trim(),
          data_evento: form.data_evento.value || null,
          local: form.local.value.trim() || null,
          meta_confirmados: Number(form.meta_confirmados.value) || 0,
        };
        ["subtitulo_convite", "texto_confirmacao", "texto_em_analise", "texto_aprovado", "texto_recusado"]
          .forEach((k) => { if (form[k]) patch[k] = form[k].value.trim() || null; });
        const salvo = await salvarEvento(patch);
        definirEvento(salvo.id, salvo.nome);
        toast("Configurações do evento salvas.", "ok");
      } catch (err) {
        toast(err.message, "erro");
      }
    };

    el("conteudo").querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = () => editarItem(b.dataset.add, null);
    });
    el("add-marco").onclick = () => editarMarco(null);
    el("add-tipo").onclick = () => editarGrupo(null);

    el("carregando").hidden = true;
    el("conteudo").hidden = false;
    montarCrachaConfig();
    montarCtaMobile();
    montarEquipe();
    await Promise.allSettled([renderGrupos(), renderResponsaveis(), renderEstagios(), renderEtapasPart(), renderMarcos(), renderCategoriasIngresso()]);
  } catch (e) {
    el("carregando").innerHTML = /evento_id|eventos|schema cache/.test(e.message || "")
      ? "Rode a migração <code>supabase/migrations/0005_eventos.sql</code> no SQL Editor do Supabase."
      : "Erro ao carregar: " + esc(e.message);
  }
}

/* ---- listas ---- */
function itemLinha(tabela, x, extra = "") {
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--cinza-100)" data-id="${x.id}">
    <span style="font-size:.9rem">${esc(x.nome)}${extra}</span>
    <span class="linha-acoes">
      <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
      <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
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
  let membros = [];
  try { membros = CTX?.org?.id ? await listarEquipe(CTX.org.id) : []; } catch { membros = []; }
  const nomeMembro = (uid) => {
    const m = membros.find((x) => x.user_id === uid);
    return m ? (m.nome || m.email) : null;
  };
  c.innerHTML = arr.length
    ? arr.map((x) => itemLinha("grupos", x,
        x.responsavel_user_id
          ? ` <span class="pagina-sub" style="font-size:.72rem">· responsável: ${esc(nomeMembro(x.responsavel_user_id) || "—")}</span>`
          : ""))
        .join("")
    : vazio();
  ligarGrupos(c, membros);
}

function ligarGrupos(container, membros) {
  container.querySelectorAll("[data-id]").forEach((row) => {
    const g = { id: row.dataset.id };
    row.querySelector("[data-editar]").onclick = async () => {
      const atual = (await listGrupos()).find((x) => x.id === row.dataset.id);
      editarGrupo(atual, membros);
    };
    row.querySelector("[data-excluir]").onclick = async () => {
      if (!confirmar("Excluir este tipo?")) return;
      try { await remover("grupos", row.dataset.id); toast("Tipo excluído.", "ok"); renderGrupos(); }
      catch (e) { toast(e.message, "erro"); }
    };
  });
}

function editarGrupo(atual, membrosCarregados) {
  const montar = async () => {
    const membros = membrosCarregados || (CTX?.org?.id ? await listarEquipe(CTX.org.id).catch(() => []) : []);
    abrirModal({
      titulo: atual ? "Editar tipo" : "Novo tipo",
      corpoHtml: `
        <label class="campo"><span>Nome *</span>
          <input class="input" name="nome" required value="${esc(atual?.nome || "")}" placeholder="Ex.: Membro, VIP, Turma A" /></label>
        <label class="campo"><span>Responsável</span>
          <select class="select" name="responsavel_user_id">
            <option value="">— sem responsável —</option>
            ${membros.map((m) => `<option value="${esc(m.user_id)}" ${m.user_id === atual?.responsavel_user_id ? "selected" : ""}>${esc(m.nome || m.email)}</option>`).join("")}
          </select>
          ${membros.length ? "" : `<span class="cel-tenue" style="font-size:.72rem">Nenhum usuário na organização ainda — cadastre em "Usuários da organização".</span>`}
        </label>`,
      onConfirmar: async (form) => {
        const f = Object.fromEntries(new FormData(form));
        const registro = { nome: f.nome.trim(), responsavel_user_id: f.responsavel_user_id || null };
        if (atual) registro.id = atual.id;
        await salvar("grupos", registro);
        toast("Tipo salvo.", "ok");
        renderGrupos();
      },
    });
  };
  montar();
}
/* ---- Categorias de ingresso: atribuição de responsável (por pessoa) ---- */
async function renderCategoriasIngresso() {
  const c = el("lista-ingressos-resp");
  if (!c) return;
  const [tipos, membros] = await Promise.all([
    listTiposIngresso().catch(() => []),
    CTX?.org?.id ? listarEquipe(CTX.org.id).catch(() => []) : [],
  ]);
  if (!membros.length) {
    c.innerHTML = `<p class="pagina-sub" style="margin:0">Cadastre pessoas em "Usuários da organização" para poder atribuir categorias.</p>`;
    return;
  }
  if (!tipos.length) {
    c.innerHTML = `<p class="pagina-sub" style="margin:0">Nenhuma categoria de ingresso cadastrada ainda. Crie em <a href="ingressos.html">Tipos de ingresso</a>.</p>`;
    return;
  }
  c.innerHTML = membros.map((m) => {
    const minhas = tipos.filter((t) => t.responsavel_user_id === m.user_id);
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--cinza-100)" data-uid="${esc(m.user_id)}">
      <span style="font-size:.9rem">${esc(m.nome || m.email)}
        ${minhas.length
          ? `<span class="pagina-sub" style="font-size:.72rem;display:block">${minhas.map((t) => esc(t.nome)).join(", ")}</span>`
          : `<span class="cel-tenue" style="font-size:.72rem;display:block">nenhuma categoria</span>`}
      </span>
      <button class="icone-btn" data-editar title="Atribuir categorias">${icone("editar")}</button>
    </div>`;
  }).join("");
  c.querySelectorAll("[data-uid]").forEach((row) => {
    row.querySelector("[data-editar]").onclick = () => editarCategoriasDoResponsavel(row.dataset.uid, membros, tipos);
  });
}

function editarCategoriasDoResponsavel(userId, membros, tipos) {
  const membro = membros.find((m) => m.user_id === userId);
  const nomeMembro = (uid) => {
    const m = membros.find((x) => x.user_id === uid);
    return m ? (m.nome || m.email) : null;
  };
  abrirModal({
    titulo: `Categorias de ${esc(membro?.nome || membro?.email || "responsável")}`,
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">Marque as categorias de ingresso pelas quais esta pessoa é responsável.</p>
      ${tipos.map((t) => {
        const outro = t.responsavel_user_id && t.responsavel_user_id !== userId ? nomeMembro(t.responsavel_user_id) : null;
        return `<label class="campo" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="cat" value="${t.id}" ${t.responsavel_user_id === userId ? "checked" : ""} />
          <span style="margin:0">${esc(t.nome)}${outro ? ` <span class="cel-tenue" style="font-size:.72rem">(hoje: ${esc(outro)})</span>` : ""}</span>
        </label>`;
      }).join("")}`,
    onConfirmar: async (form) => {
      const marcados = new Set([...form.querySelectorAll('[name="cat"]:checked')].map((i) => i.value));
      const alterar = tipos.filter((t) => (t.responsavel_user_id === userId) !== marcados.has(t.id));
      for (const t of alterar) {
        await salvar("tipos_ingresso", { id: t.id, responsavel_user_id: marcados.has(t.id) ? userId : null });
      }
      toast("Categorias atualizadas.", "ok");
      renderCategoriasIngresso();
    },
  });
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
async function renderEtapasPart() {
  const c = el("lista-etapas-part");
  let arr;
  try {
    arr = await listEtapasParticipante();
  } catch {
    c.innerHTML = `<p class="pagina-sub" style="margin:0">Rode a migração <code>0004_participantes.sql</code> para ativar.</p>`;
    return;
  }
  c.innerHTML = arr.length
    ? arr.map((x) => itemLinha("etapas_participante", x, ` <span class="pagina-sub" style="font-size:.72rem">ordem ${x.ordem}</span>`)).join("")
    : vazio();
  ligar(c, "etapas_participante", renderEtapasPart);
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

/* ---- Crachá / Etiqueta ---- */
const CR_ROTULOS = {
  evento: "Nome do evento", nome: "Nome completo", categoria: "Categoria",
  texto: "Texto livre", empresa: "Empresa", email: "E-mail",
  telefone: "Telefone", codigo: "Código",
};
const CR_FIXOS = ["evento", "nome", "categoria"];
const CR_FAKE = {
  nome: "Maria Aparecida da Silva", empresa: "Acme Consultoria Ltda",
  email: "maria@acme.com.br", telefone: "(11) 99999-0000", ingresso: "VIP", codigo: "IMER-0042",
};

function crachaConfigAtual() {
  const base = JSON.parse(JSON.stringify(CRACHA_PADRAO));
  const salvo = config?.cracha_config;
  if (!salvo) return base;
  base.largura_mm = salvo.largura_mm ?? base.largura_mm;
  base.altura_mm = salvo.altura_mm ?? base.altura_mm;
  base.qr = salvo.qr !== false;
  base.linhas = base.linhas.map((l) => {
    const s = (salvo.linhas || []).find((x) => x.campo === l.campo);
    return s ? { ...l, ...s } : l;
  });
  return base;
}

function montarCrachaConfig() {
  const cfg = crachaConfigAtual();
  el("cr-largura").value = cfg.largura_mm;
  el("cr-altura").value = cfg.altura_mm;
  el("cr-qr").checked = cfg.qr !== false;

  const opts = (tam) => {
    const sel = snapTamanho(Number(tam) || 18);
    return TAMANHOS_CRACHA
      .map((t) => `<option value="${t.valor}" ${sel === t.valor ? "selected" : ""}>${t.rotulo}</option>`).join("");
  };

  el("cr-linhas").innerHTML = cfg.linhas.map((l) => {
    const fixo = CR_FIXOS.includes(l.campo);
    return `<div class="cracha-linha-cfg" data-campo="${l.campo}">
      <input type="checkbox" data-on ${l.on !== false ? "checked" : ""} ${fixo ? "disabled" : ""} />
      <span class="rot">${esc(CR_ROTULOS[l.campo] || l.campo)}${fixo ? ' <span class="pagina-sub" style="font-size:.7rem">(obrigatório)</span>' : ""}
        ${l.campo === "texto" ? `<input class="input" data-texto value="${esc(l.texto || "")}" placeholder="texto fixo do crachá" style="margin-top:5px" />` : ""}
      </span>
      <select class="select" data-tam>${opts(l.tam)}</select>
    </div>`;
  }).join("");

  let crUri = null;
  qrDataURL(CR_FAKE.codigo).then((u) => { crUri = u; preview(); });
  const preview = () => {
    const cfg = lerCrachaConfig();
    el("cr-preview").innerHTML = montarCrachaHtml(CR_FAKE, config?.nome || "Nome do Evento", cfg, cfg.qr ? crUri : null);
  };
  el("conteudo").querySelectorAll("#cr-largura,#cr-altura,#cr-qr,#cr-linhas input,#cr-linhas select")
    .forEach((c) => { c.oninput = preview; c.onchange = preview; });
  el("cr-salvar").onclick = salvarCracha;
  preview();
}

function lerCrachaConfig() {
  return {
    largura_mm: Number(el("cr-largura").value) || 90,
    altura_mm: Number(el("cr-altura").value) || 55,
    qr: el("cr-qr").checked,
    linhas: [...el("cr-linhas").querySelectorAll(".cracha-linha-cfg")].map((row) => {
      const campo = row.dataset.campo;
      const o = {
        campo,
        on: CR_FIXOS.includes(campo) ? true : row.querySelector("[data-on]").checked,
        tam: Number(row.querySelector("[data-tam]").value) || 14,
      };
      if (campo === "texto") o.texto = row.querySelector("[data-texto]").value.trim();
      return o;
    }),
  };
}

async function salvarCracha() {
  try {
    const salvo = await salvarEvento({ cracha_config: lerCrachaConfig() });
    config = salvo;
    toast("Crachá salvo.", "ok");
  } catch (e) { toast(e.message, "erro"); }
}

/* ---- Usuários da organização (Edge Function "equipe") ---- */
async function montarEquipe() {
  const c = el("equipe-lista");
  const bloco = el("equipe-lista")?.closest(".cfg-bloco");
  if (!c) return;
  const orgId = CTX?.org?.id;
  const podeGerir = CTX?.superAdmin || CTX?.papel === "admin";
  if (bloco) bloco.hidden = !podeGerir;
  if (!podeGerir || !orgId) return;
  el("equipe-add").onclick = () => modalMembro();
  c.innerHTML = `<p class="pagina-sub" style="margin:0">Carregando…</p>`;
  try {
    const membros = await listarEquipe(orgId);
    if (!membros.length) {
      c.innerHTML = `<p class="pagina-sub" style="margin:0">Ninguém com acesso ainda. Clique em “+ Adicionar pessoa”.</p>`;
      return;
    }
    c.innerHTML = membros.map((m) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--cinza-100)" data-id="${esc(m.id)}">
        <div style="min-width:0">
          <div style="font-size:.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(m.email || "—")}</div>
          <div class="pagina-sub" style="margin:2px 0 0;font-size:.74rem">
            ${m.ultimo_login ? "último acesso " + formatarData(m.ultimo_login) : "nunca acessou"}
          </div>
        </div>
        <span class="linha-acoes">
          <button class="btn btn-secundario btn-sm" data-senha title="Trocar senha">Senha</button>
          <button class="icone-btn" data-excluir title="Remover acesso">${icone("excluir")}</button>
        </span>
      </div>`).join("");
    c.querySelectorAll("[data-id]").forEach((row) => {
      const m = membros.find((x) => x.id === row.dataset.id);
      row.querySelector("[data-senha]").onclick = () => modalMembro(m);
      row.querySelector("[data-excluir]").onclick = async () => {
        if (!confirmar(`Remover o acesso de ${m.email}?`)) return;
        try { await removerMembroEquipe(CTX.org.id, m.id); toast("Acesso removido.", "ok"); montarEquipe(); }
        catch (e) { toast(e.message, "erro"); }
      };
    });
  } catch (e) {
    c.innerHTML = `<p class="pagina-sub" style="margin:0">${/deploy/.test(e.message)
      ? "Faça o deploy de <code>supabase/functions/equipe</code> para gerenciar os logins por aqui."
      : esc(e.message)}</p>`;
  }
}

function modalMembro(m) {
  abrirModal({
    titulo: m ? `Trocar senha — ${m.email}` : "Adicionar pessoa à organização",
    textoConfirmar: m ? "Salvar senha" : "Criar acesso",
    corpoHtml: `
      ${m ? "" : `<label class="campo"><span>Nome</span>
          <input class="input" name="nome" placeholder="Nome da pessoa" /></label>
        <label class="campo"><span>E-mail *</span>
          <input class="input" name="email" type="email" required placeholder="pessoa@email.com" /></label>
        <label class="campo"><span>Papel</span>
          <select class="select" name="papel"><option value="membro">Membro</option><option value="admin">Admin (gerencia usuários)</option></select></label>`}
      <label class="campo"><span>${m ? "Nova senha *" : "Senha (opcional)"}</span>
        <input class="input" name="senha" type="text" ${m ? "required" : ""} minlength="6" placeholder="${m ? "mín. 6 caracteres" : "em branco = manda convite por e-mail"}" /></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      if (m) {
        await trocarSenhaMembro(CTX.org.id, m.id, f.senha);
        toast("Senha atualizada.", "ok");
      } else {
        const r = await criarMembroEquipe(CTX.org.id, {
          email: f.email.trim(), senha: f.senha || undefined, nome: f.nome || null, papel: f.papel,
        });
        toast(r.link ? "Convite enviado por e-mail." : "Acesso criado.", "ok");
      }
      montarEquipe();
    },
  });
}

/* ---- CTA: check-in pelo celular (link + QR) ---- */
function montarCtaMobile() {
  const inp = el("ck-mobile-link");
  if (!inp) return;
  const link = new URL(`../checkin-app.html?evento=${eventoId()}`, location.href).href;
  inp.value = link;
  el("ck-mobile-abrir").href = link;
  el("ck-mobile-copiar").onclick = () =>
    navigator.clipboard.writeText(link).then(() => toast("Link copiado.", "ok"));
  qrDataURL(link).then((uri) => {
    if (uri) el("ck-mobile-qr").innerHTML = `<img src="${uri}" alt="QR do check-in no celular" />`;
  });
}

/* ---- editar / criar (responsaveis, estagios, etapas_participante — "grupos" tem editor próprio, editarGrupo) ---- */
const RECARGA = {
  responsaveis: renderResponsaveis,
  estagios: renderEstagios, etapas_participante: renderEtapasPart,
};
const TITULO = {
  responsaveis: "responsável",
  estagios: "estágio", etapas_participante: "etapa",
};
const COM_ORDEM = ["estagios", "etapas_participante"];

async function editarItem(tabela, id, recarregar) {
  recarregar = recarregar || RECARGA[tabela];
  let atual = null;
  if (id) {
    const fn = {
      responsaveis: listResponsaveis,
      estagios: listEstagios, etapas_participante: listEtapasParticipante,
    }[tabela];
    atual = (await fn()).find((x) => x.id === id);
  }
  abrirModal({
    titulo: (id ? "Editar " : "Nova ") + TITULO[tabela],
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(atual?.nome || "")}" /></label>
      ${
        COM_ORDEM.includes(tabela)
          ? `<label class="campo"><span>Ordem</span>
               <input class="input" type="number" name="ordem" value="${atual?.ordem ?? ""}" /></label>
             <label class="campo"><span>Cor (hex, opcional)</span>
               <input class="input" name="cor" value="${esc(atual?.cor || "")}" placeholder="#7c3aed" /></label>`
          : ""
      }`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const registro = { nome: f.nome.trim() };
      if (COM_ORDEM.includes(tabela)) {
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
