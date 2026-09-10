// =============================================================================
// Integrações e webhooks — CRUD por evento. Três tipos de linha em `integracoes`:
//   webhook_saida  → POST JSON numa URL quando um gatilho ocorre
//   conector       → empurra p/ uma plataforma via API (ActiveCampaign, Z-API…)
//   entrada        → o evento recebe POSTs (ticketeira/gateway) na função webhook-in
// O disparo de saída é feito pela Edge Function "integracoes"; a entrada pela
// função "webhook-in". Sem deploy, o cadastro funciona mas nada é enviado.
// =============================================================================
import { iniciarPagina, esc, formatarData, abrirModal, toast, confirmar, icone } from "./ui.js";
import {
  listIntegracoes, listWebhookEntregas, salvar, remover,
  webhookEntradaUrl, testarIntegracao,
} from "./supabase.js";

iniciarPagina("integracoes");
const el = (id) => document.getElementById(id);

let integracoes = [];
let entregas = [];

const GATILHOS = [
  { valor: "participante.criado",     rotulo: "Participante criado" },
  { valor: "participante.atualizado", rotulo: "Participante atualizado" },
  { valor: "participante.situacao",   rotulo: "Situação mudou (confirmado / não vai…)" },
  { valor: "convidado.aprovado",      rotulo: "Convidado aprovado" },
  { valor: "checkin.realizado",       rotulo: "Check-in no evento" },
  { valor: "checkin.atividade",       rotulo: "Check-in em atividade" },
];
const rotuloGatilho = (v) => GATILHOS.find((g) => g.valor === v)?.rotulo || v;

// Conectores disponíveis (provedor → como cadastrar)
const CONECTORES = {
  activecampaign: {
    nome: "ActiveCampaign", desc: "Sincroniza o contato (nome, e-mail, telefone) na sua conta.",
    campos: [
      { k: "base_url", rotulo: "URL da conta", ex: "https://suaconta.api-us1.com", req: true },
      { k: "api_key",  rotulo: "API Key", tipo: "password", req: true },
    ],
  },
  zapi: {
    nome: "Z-API (WhatsApp)", desc: "Dispara uma mensagem de WhatsApp a cada gatilho.",
    campos: [
      { k: "instancia", rotulo: "ID da instância", req: true },
      { k: "token", rotulo: "Token da instância", tipo: "password", req: true },
      { k: "client_token", rotulo: "Client-Token (segurança da conta)", tipo: "password" },
      { k: "telefone_destino", rotulo: "Telefone que recebe o aviso (com DDI)", ex: "5511999998888" },
      { k: "mensagem", rotulo: "Modelo da mensagem", tipo: "textarea",
        ex: "Novo em {evento}: {nome} ({gatilho})" },
    ],
  },
  generico: {
    nome: "HTTP genérico", desc: "POST em JSON numa URL — igual a um webhook de saída, agrupado aqui.",
    campos: [{ k: "_url", rotulo: "URL", ex: "https://…", req: true }],
  },
};

// Origens de entrada (só um rótulo — todas usam o mesmo mapeador genérico)
const ORIGENS = ["Genérico / Zapier", "Sympla", "Even3", "Eventbrite", "Hotmart", "Eduzz", "Mercado Pago", "Stripe", "Outro"];

carregar();
el("add-webhook").onclick = () => modalWebhook(null);
el("add-entrada").onclick = () => modalEntrada(null);

async function carregar() {
  try {
    [integracoes, entregas] = await Promise.all([
      listIntegracoes(),
      listWebhookEntregas().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("conteudo").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /integracoes|schema cache|does not exist/.test(e.message || "")
      ? `Rode a migração <code>supabase/migrations/0014_integracoes.sql</code> no SQL Editor do Supabase para ativar esta tela.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

async function recarregar() {
  integracoes = await listIntegracoes().catch(() => integracoes);
  entregas = await listWebhookEntregas().catch(() => entregas);
  render();
}

function render() {
  renderWebhooks();
  renderConectores();
  renderEntradas();
  renderLog();
}

/* ---- helpers de linha ---- */
const badgeAtivo = (a) =>
  a ? `<span class="badge badge-ok">Ativo</span>` : `<span class="badge badge-neutro">Pausado</span>`;

function acoesHtml(row, comTeste) {
  return `<span class="linha-acoes">
    ${comTeste ? `<button class="btn btn-secundario btn-sm" data-testar="${row.id}">Testar</button>` : ""}
    <button class="icone-btn" data-toggle="${row.id}" title="${row.ativo ? "Pausar" : "Ativar"}">${icone(row.ativo ? "pausar" : "play")}</button>
    <button class="icone-btn" data-editar="${row.id}" title="Editar">${icone("editar")}</button>
    <button class="icone-btn" data-excluir="${row.id}" title="Excluir">${icone("excluir")}</button>
  </span>`;
}

function ligarLinhas(container) {
  container.querySelectorAll("[data-editar]").forEach((b) => {
    b.onclick = () => {
      const row = integracoes.find((x) => x.id === b.dataset.editar);
      if (row.tipo === "webhook_saida") modalWebhook(row);
      else if (row.tipo === "entrada") modalEntrada(row);
      else modalConector(row.provedor, row);
    };
  });
  container.querySelectorAll("[data-excluir]").forEach((b) => {
    b.onclick = async () => {
      if (!confirmar("Excluir esta integração?")) return;
      try { await remover("integracoes", b.dataset.excluir); toast("Excluída.", "ok"); recarregar(); }
      catch (e) { toast(e.message, "erro"); }
    };
  });
  container.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      const row = integracoes.find((x) => x.id === b.dataset.toggle);
      try { await salvar("integracoes", { id: row.id, ativo: !row.ativo }); recarregar(); }
      catch (e) { toast(e.message, "erro"); }
    };
  });
  container.querySelectorAll("[data-testar]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = "Enviando…";
      try {
        const r = await testarIntegracao(b.dataset.testar);
        const ok = r.entregas?.[0]?.ok;
        toast(ok ? "Teste entregue com sucesso." : `Falhou: ${r.entregas?.[0]?.erro || "sem resposta"}`, ok ? "ok" : "erro");
        recarregar();
      } catch (e) { toast(e.message, "erro"); }
      finally { b.disabled = false; b.textContent = "Testar"; }
    };
  });
  container.querySelectorAll("[data-copiar]").forEach((b) => {
    b.onclick = () => navigator.clipboard.writeText(b.dataset.copiar).then(() => toast("Copiado.", "ok"));
  });
}

const vazio = (txt) => `<p class="pagina-sub" style="margin:0">${txt}</p>`;

/* ---- Webhooks de saída ---- */
function renderWebhooks() {
  const arr = integracoes.filter((x) => x.tipo === "webhook_saida");
  const c = el("lista-webhooks");
  c.innerHTML = arr.length ? arr.map((w) => `
    <div class="integ-linha" data-id="${w.id}">
      <div class="integ-linha-info">
        <div class="integ-linha-nome">${esc(w.nome)} ${badgeAtivo(w.ativo)}</div>
        <div class="integ-linha-url">${esc(w.url || "—")}</div>
        <div class="integ-tags">${(w.eventos?.length ? w.eventos : GATILHOS.map((g) => g.valor))
          .map((g) => `<span class="integ-tag">${esc(rotuloGatilho(g))}</span>`).join("")}</div>
      </div>
      ${acoesHtml(w, true)}
    </div>`).join("") : vazio("Nenhum webhook de saída ainda.");
  ligarLinhas(c);
}

function modalWebhook(row) {
  abrirModal({
    titulo: row ? "Editar webhook" : "Novo webhook de saída",
    textoConfirmar: row ? "Salvar" : "Criar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(row?.nome || "")}" placeholder="Ex.: Zapier — novos inscritos" /></label>
      <label class="campo"><span>URL de destino *</span>
        <input class="input" name="url" type="url" required value="${esc(row?.url || "")}" placeholder="https://hooks.zapier.com/…" /></label>
      <label class="campo"><span>Segredo (opcional)</span>
        <input class="input" name="segredo" value="${esc(row?.segredo || "")}" placeholder="assina o corpo em X-WeEvents-Signature" /></label>
      <div class="campo"><span>Disparar em</span>
        <div class="integ-checks">
          ${GATILHOS.map((g) => `<label><input type="checkbox" name="gatilhos" value="${g.valor}"
            ${!row || !row.eventos?.length || row.eventos.includes(g.valor) ? "checked" : ""} /> ${esc(g.rotulo)}</label>`).join("")}
        </div>
        <span class="cel-tenue" style="font-size:.72rem">Nada marcado = todos os gatilhos.</span>
      </div>`,
    onConfirmar: async (form) => {
      const fd = new FormData(form);
      const gatilhos = fd.getAll("gatilhos");
      const reg = {
        tipo: "webhook_saida", provedor: "generico",
        nome: fd.get("nome").trim(),
        url: fd.get("url").trim(),
        segredo: fd.get("segredo").trim() || null,
        eventos: gatilhos.length === GATILHOS.length ? [] : gatilhos,
      };
      if (row) reg.id = row.id;
      await salvar("integracoes", reg);
      toast("Webhook salvo.", "ok");
      recarregar();
    },
  });
}

/* ---- Conectores ---- */
function renderConectores() {
  el("conectores").innerHTML = Object.entries(CONECTORES).map(([prov, c]) => `
    <button type="button" class="integ-card" data-conector="${prov}">
      <span class="integ-card-nome">${esc(c.nome)}</span>
      <span class="integ-card-desc">${esc(c.desc)}</span>
      <span class="integ-card-add">${icone("mais")} Conectar</span>
    </button>`).join("");
  el("conectores").querySelectorAll("[data-conector]").forEach((b) => {
    b.onclick = () => modalConector(b.dataset.conector, null);
  });

  const arr = integracoes.filter((x) => x.tipo === "conector");
  const c = el("lista-conectores");
  c.innerHTML = arr.length ? arr.map((w) => `
    <div class="integ-linha" data-id="${w.id}">
      <div class="integ-linha-info">
        <div class="integ-linha-nome">${esc(w.nome)} ${badgeAtivo(w.ativo)}
          <span class="badge badge-info">${esc(CONECTORES[w.provedor]?.nome || w.provedor)}</span></div>
        <div class="integ-tags">${(w.eventos?.length ? w.eventos : GATILHOS.map((g) => g.valor))
          .map((g) => `<span class="integ-tag">${esc(rotuloGatilho(g))}</span>`).join("")}</div>
      </div>
      ${acoesHtml(w, true)}
    </div>`).join("") : "";
  ligarLinhas(c);
}

function modalConector(prov, row) {
  const meta = CONECTORES[prov];
  if (!meta) return;
  const cfg = row?.config || {};
  const campoHtml = (f) => {
    const v = f.k === "_url" ? (row?.url || "") : (cfg[f.k] || "");
    const base = f.tipo === "textarea"
      ? `<textarea class="input" name="${f.k}" rows="2" placeholder="${esc(f.ex || "")}">${esc(v)}</textarea>`
      : `<input class="input" name="${f.k}" type="${f.tipo === "password" ? "password" : "text"}" value="${esc(v)}" placeholder="${esc(f.ex || "")}" ${f.req ? "required" : ""} />`;
    return `<label class="campo"><span>${esc(f.rotulo)}${f.req ? " *" : ""}</span>${base}</label>`;
  };
  abrirModal({
    titulo: (row ? "Editar " : "Conectar ") + meta.nome,
    textoConfirmar: row ? "Salvar" : "Conectar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 12px">${esc(meta.desc)}</p>
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(row?.nome || meta.nome)}" /></label>
      ${meta.campos.map(campoHtml).join("")}
      <div class="campo"><span>Disparar em</span>
        <div class="integ-checks">
          ${GATILHOS.map((g) => `<label><input type="checkbox" name="gatilhos" value="${g.valor}"
            ${!row || !row.eventos?.length || row.eventos.includes(g.valor) ? "checked" : ""} /> ${esc(g.rotulo)}</label>`).join("")}
        </div>
      </div>`,
    onConfirmar: async (form) => {
      const fd = new FormData(form);
      const gatilhos = fd.getAll("gatilhos");
      const config = {};
      let url = null;
      meta.campos.forEach((f) => {
        const val = (fd.get(f.k) || "").toString().trim();
        if (f.k === "_url") url = val || null;
        else if (val) config[f.k] = val;
      });
      const reg = {
        tipo: "conector", provedor: prov,
        nome: fd.get("nome").trim(),
        url, config,
        eventos: gatilhos.length === GATILHOS.length ? [] : gatilhos,
      };
      if (row) reg.id = row.id;
      await salvar("integracoes", reg);
      toast("Conector salvo.", "ok");
      recarregar();
    },
  });
}

/* ---- Webhook de entrada ---- */
function renderEntradas() {
  const arr = integracoes.filter((x) => x.tipo === "entrada");
  const c = el("lista-entradas");
  c.innerHTML = arr.length ? arr.map((w) => {
    const url = webhookEntradaUrl(w.token);
    return `<div class="integ-linha coluna" data-id="${w.id}">
      <div class="integ-linha-nome">${esc(w.nome)} ${badgeAtivo(w.ativo)}
        ${w.provedor ? `<span class="badge badge-info">${esc(w.provedor)}</span>` : ""}</div>
      <div class="integ-url-box">
        <code>${esc(url)}</code>
        <button class="btn btn-secundario btn-sm" data-copiar="${esc(url)}">Copiar</button>
      </div>
      ${acoesHtml(w, false)}
    </div>`;
  }).join("") : vazio("Nenhuma origem de entrada. Crie uma para receber inscrições de fora.");
  ligarLinhas(c);
}

function modalEntrada(row) {
  const cfg = row?.config || {};
  abrirModal({
    titulo: row ? "Editar origem" : "Nova origem de entrada",
    textoConfirmar: row ? "Salvar" : "Criar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(row?.nome || "")}" placeholder="Ex.: Sympla — lote 1" /></label>
      <label class="campo"><span>Plataforma</span>
        <select class="select" name="provedor">
          ${ORIGENS.map((o) => `<option ${o === (row?.provedor || "") ? "selected" : ""}>${o}</option>`).join("")}
        </select></label>
      <label class="campo"><span>Situação dos participantes criados</span>
        <select class="select" name="situacao_padrao">
          ${["", "Confirmado", "Pendente", "Pré-inscrito", "Fila de espera"].map((s) =>
            `<option value="${s}" ${s === (cfg.situacao_padrao || "") ? "selected" : ""}>${s || "Automática (pelo status recebido)"}</option>`).join("")}
        </select></label>
      <label class="campo"><span>Mapa de campos (opcional, JSON)</span>
        <textarea class="input" name="mapa" rows="3" placeholder='{ "email": "buyer.email", "nome": "buyer.name" }'>${esc(cfg.mapa ? JSON.stringify(cfg.mapa, null, 0) : "")}</textarea>
        <span class="cel-tenue" style="font-size:.72rem">Sem mapa, o We.events procura nome/e-mail/telefone nas chaves comuns do corpo.</span></label>
      ${row ? "" : `<p class="pagina-sub" style="margin:6px 0 0;font-size:.8rem">A URL com token aparece na lista depois de criar.</p>`}`,
    onConfirmar: async (form) => {
      const fd = new FormData(form);
      let mapa = null;
      const mapaTxt = (fd.get("mapa") || "").toString().trim();
      if (mapaTxt) {
        try { mapa = JSON.parse(mapaTxt); }
        catch { toast("O mapa de campos não é um JSON válido.", "erro"); return false; }
      }
      const config = {};
      if (fd.get("situacao_padrao")) config.situacao_padrao = fd.get("situacao_padrao");
      if (mapa) config.mapa = mapa;
      const reg = {
        tipo: "entrada",
        nome: fd.get("nome").trim(),
        provedor: fd.get("provedor") || null,
        config,
      };
      if (row) reg.id = row.id;
      await salvar("integracoes", reg);
      toast("Origem salva.", "ok");
      recarregar();
    },
  });
}

/* ---- Log ---- */
function renderLog() {
  const nome = (id) => integracoes.find((x) => x.id === id)?.nome || "—";
  el("wrap-log").hidden = entregas.length === 0;
  el("vazio-log").hidden = entregas.length !== 0;
  el("linhas-log").innerHTML = entregas.map((e) => `
    <tr>
      <td>${formatarData(e.at, true)}</td>
      <td>${esc(nome(e.integracao_id))}</td>
      <td><span class="integ-tag">${esc(rotuloGatilho(e.gatilho || "—"))}</span></td>
      <td>${e.ok
        ? `<span class="badge badge-ok">OK${e.status ? " " + e.status : ""}</span>`
        : `<span class="badge badge-erro" title="${esc(e.erro || "")}">Falhou${e.status ? " " + e.status : ""}</span>`}</td>
    </tr>`).join("");
}
