// =============================================================================
// Configurações — geral + CRUD de grupos, responsáveis e estágios.
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast, confirmar, icone } from "./ui.js";
import {
  listGrupos, listResponsaveis, listEstagios, listEtapasParticipante, listMarcos,
  getEvento, salvar, remover, salvarEvento,
} from "./supabase.js";
import { eventoId, definirEvento } from "./evento.js";
import { montarCrachaHtml, CRACHA_PADRAO, TAMANHOS_CRACHA, snapTamanho, qrDataURL } from "./cracha.js";

iniciarPagina("config");
const el = (id) => document.getElementById(id);

let config = null;

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

carregar();

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

    el("carregando").hidden = true;
    el("conteudo").hidden = false;
    montarCrachaConfig();
    await Promise.allSettled([renderGrupos(), renderResponsaveis(), renderEstagios(), renderEtapasPart(), renderMarcos()]);
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

/* ---- editar / criar ---- */
const RECARGA = {
  grupos: renderGrupos, responsaveis: renderResponsaveis,
  estagios: renderEstagios, etapas_participante: renderEtapasPart,
};
const TITULO = {
  grupos: "grupo", responsaveis: "responsável",
  estagios: "estágio", etapas_participante: "etapa",
};
const COM_ORDEM = ["estagios", "etapas_participante"];

async function editarItem(tabela, id, recarregar) {
  recarregar = recarregar || RECARGA[tabela];
  let atual = null;
  if (id) {
    const fn = {
      grupos: listGrupos, responsaveis: listResponsaveis,
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
               <input class="input" name="cor" value="${esc(atual?.cor || "")}" placeholder="#ea580c" /></label>`
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
