// =============================================================================
// Tipos de ingresso — CRUD das categorias de inscrição do evento.
// A coluna "Análise" cruza com participantes.ingresso (por nome) e mostra a
// distribuição por situação + vagas preenchidas.
// =============================================================================
import { iniciarPagina, esc, debounce, formatarData, abrirModal, toast, confirmar, icone } from "./ui.js";
import { listTiposIngresso, listParticipantes, listCamposPersonalizados, salvar, remover } from "./supabase.js";
import { baixarXLSX } from "./tabela.js";
import { TIPOS_CAMPO_PERSONALIZADO } from "./config.js";

const _iniciando = iniciarPagina("ingressos");
const el = (id) => document.getElementById(id);

let tipos = [], participantes = [], campos = [];
let termo = "";

const SIT_ORDEM = ["Confirmado", "Pendente", "Fila de espera", "Pré-inscrito", "Desativado"];
const rotuloTipoCampo = (v) => TIPOS_CAMPO_PERSONALIZADO.find((t) => t.valor === v)?.rotulo || v;

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });
el("btn-novo").onclick = () => editar(null);
el("btn-exportar").onclick = exportar;
el("add-campo").onclick = () => modalCampo(null);
el("busca").addEventListener("input", debounce((e) => { termo = e.target.value.trim().toLowerCase(); render(); }, 150));

async function carregar() {
  try {
    [tipos, participantes, campos] = await Promise.all([
      listTiposIngresso(),
      listParticipantes().catch(() => []),
      listCamposPersonalizados().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    const falta = /tipos_ingresso|schema cache|does not exist/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0012_tipos_ingresso.sql</code> no SQL Editor do Supabase para ativar esta tela.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

// participantes de um tipo (casa por nome, sem diferenciar maiúsculas)
function doTipo(nome) {
  const n = (nome || "").trim().toLowerCase();
  return participantes.filter((p) => (p.ingresso || "").trim().toLowerCase() === n);
}
function analise(nome) {
  const ps = doTipo(nome);
  const por = {};
  ps.forEach((p) => { const s = p.situacao || "Confirmado"; por[s] = (por[s] || 0) + 1; });
  return { total: ps.length, ativos: ps.filter((p) => (p.situacao || "Confirmado") !== "Desativado").length, por };
}

function filtrados() {
  return tipos.filter((t) => !termo || (t.nome || "").toLowerCase().includes(termo));
}

function render() {
  const lista = filtrados();
  el("wrap").hidden = lista.length === 0;
  el("vazio").hidden = lista.length !== 0;
  if (lista.length) {
    el("linhas").innerHTML = lista.map(linhaHtml).join("");
    el("linhas").querySelectorAll("tr").forEach((tr) => {
      const t = tipos.find((x) => x.id === tr.dataset.id);
      tr.querySelector("[data-editar]").onclick = () => editar(t);
      tr.querySelector("[data-excluir]").onclick = () => excluir(t);
    });
  } else {
    el("linhas").innerHTML = "";
  }
  renderCampos();
}

/* ---- Campos personalizados ---- */
function renderCampos() {
  const c = el("lista-campos");
  c.innerHTML = campos.length ? campos.map((cp) => `
    <div class="integ-linha" data-id="${cp.id}">
      <div class="integ-linha-info">
        <div class="integ-linha-nome">${esc(cp.nome)} ${cp.ativo ? `<span class="badge badge-ok">Ativo</span>` : `<span class="badge badge-neutro">Pausado</span>`}
          <span class="badge badge-info">${esc(rotuloTipoCampo(cp.tipo))}</span></div>
        ${cp.tipo !== "texto" && cp.opcoes?.length ? `<div class="integ-tags">${cp.opcoes.map((o) => `<span class="integ-tag">${esc(o)}</span>`).join("")}</div>` : ""}
      </div>
      <span class="linha-acoes">
        <button class="icone-btn" data-toggle-campo="${cp.id}" title="${cp.ativo ? "Pausar" : "Ativar"}">${icone(cp.ativo ? "pausar" : "play")}</button>
        <button class="icone-btn" data-editar-campo="${cp.id}" title="Editar">${icone("editar")}</button>
        <button class="icone-btn" data-excluir-campo="${cp.id}" title="Excluir">${icone("excluir")}</button>
      </span>
    </div>`).join("") : `<p class="pagina-sub" style="margin:0">Nenhum campo personalizado ainda.</p>`;
  c.querySelectorAll("[data-editar-campo]").forEach((b) => {
    b.onclick = () => modalCampo(campos.find((x) => x.id === b.dataset.editarCampo));
  });
  c.querySelectorAll("[data-excluir-campo]").forEach((b) => {
    b.onclick = async () => {
      if (!confirmar("Excluir este campo? As respostas já preenchidas pelos participantes continuam salvas, só somem da tela.")) return;
      try { await remover("campos_personalizados", b.dataset.excluirCampo); toast("Excluído.", "ok"); carregar(); }
      catch (e) { toast(e.message, "erro"); }
    };
  });
  c.querySelectorAll("[data-toggle-campo]").forEach((b) => {
    b.onclick = async () => {
      const cp = campos.find((x) => x.id === b.dataset.toggleCampo);
      try { await salvar("campos_personalizados", { id: cp.id, ativo: !cp.ativo }); carregar(); }
      catch (e) { toast(e.message, "erro"); }
    };
  });
}

function modalCampo(cp) {
  abrirModal({
    titulo: cp ? "Editar campo" : "Novo campo personalizado",
    textoConfirmar: cp ? "Salvar" : "Criar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(cp?.nome || "")}" placeholder="Ex.: Renda mensal" /></label>
      <label class="campo"><span>Tipo *</span>
        <select class="select" name="tipo">
          ${TIPOS_CAMPO_PERSONALIZADO.map((t) => `<option value="${t.valor}" ${t.valor === (cp?.tipo || "texto") ? "selected" : ""}>${esc(t.rotulo)}</option>`).join("")}
        </select></label>
      <div id="opcoes-box" ${!cp || cp.tipo === "texto" ? "hidden" : ""}>
        <label class="campo"><span>Opções (uma por linha)</span>
          <textarea class="input" name="opcoes" rows="4" placeholder="Até R$ 5 mil&#10;R$ 5 mil – R$ 15 mil&#10;Acima de R$ 15 mil">${esc((cp?.opcoes || []).join("\n"))}</textarea></label>
      </div>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" name="ativo" ${cp?.ativo !== false ? "checked" : ""} /> <span style="margin:0">Ativo</span></label>`,
    aoMontar: (root) => {
      const selTipo = root.querySelector('[name="tipo"]');
      const box = root.querySelector("#opcoes-box");
      selTipo.onchange = () => { box.hidden = selTipo.value === "texto"; };
    },
    onConfirmar: async (form) => {
      const fd = new FormData(form);
      const tipo = fd.get("tipo");
      const opcoes = tipo === "texto" ? [] : (fd.get("opcoes") || "").toString().split("\n").map((s) => s.trim()).filter(Boolean);
      if (tipo !== "texto" && !opcoes.length) { toast("Adicione ao menos uma opção.", "erro"); return false; }
      const reg = {
        nome: fd.get("nome").trim(),
        tipo, opcoes,
        ativo: form.querySelector('[name="ativo"]').checked,
      };
      if (cp) reg.id = cp.id;
      else reg.chave = fd.get("nome").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `campo_${Date.now()}`;
      try {
        await salvar("campos_personalizados", reg);
      } catch (e) {
        const msg = e.message || "";
        toast(/unique|duplicate/.test(msg) ? "Já existe um campo com esse nome." : msg, "erro");
        return false;
      }
      toast("Salvo.", "ok");
      carregar();
    },
  });
}

function linhaHtml(t) {
  const a = analise(t.nome);
  const temVagas = Number.isFinite(t.vagas) && t.vagas > 0;
  const pct = temVagas ? Math.min(100, Math.round((a.ativos / t.vagas) * 100)) : 0;
  const periodo = [t.inicio_vendas, t.fim_vendas].filter(Boolean).map((d) => formatarData(d + "T12:00:00")).join(" – ");
  const chips = SIT_ORDEM
    .filter((s) => a.por[s])
    .map((s) => `<span class="badge ${badgeSit(s)}" style="font-size:.66rem">${a.por[s]} ${s.toLowerCase()}</span>`)
    .join(" ");
  return `<tr data-id="${t.id}">
    <td>
      <strong>${esc(t.nome)}</strong>
      ${periodo ? `<span class="cel-sub">${esc(periodo)}</span>` : ""}
      ${t.oculto ? `<span class="cel-sub">🔒 oculto (só via link direto)</span>` : ""}
      ${cfgChips(t)}
    </td>
    <td>${esc(t.preco || "Gratuito")}</td>
    <td>
      ${temVagas
        ? `<div class="checkin-num" style="font-size:.8rem"><b style="font-size:1rem">${a.ativos}</b><span>/ ${t.vagas}</span></div>
           <div class="checkin-barra" style="max-width:90px;margin-top:4px"><i style="width:${pct}%;background:${a.ativos >= t.vagas ? "var(--erro)" : "var(--ok-solid)"}"></i></div>`
        : `<span>${a.ativos}</span> <span class="cel-tenue" style="font-size:.75rem">/ ilimitado</span>`}
    </td>
    <td>${chips || `<span class="cel-tenue">—</span>`}</td>
    <td>${t.ativo ? `<span class="badge badge-ok">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
    <td class="linha-acoes">
      <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
      <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
    </td>
  </tr>`;
}

const badgeSit = (s) =>
  ({ Confirmado: "badge-ok", Pendente: "badge-alerta", "Fila de espera": "badge-info",
     "Pré-inscrito": "badge-neutro", Desativado: "badge-erro" }[s] || "badge-neutro");

// mini-resumo das configs que mudam comportamento
function cfgChips(t) {
  const c = [];
  if (t.lista_espera) c.push("fila de espera ao lotar");
  if (t.acesso_dias === "um_dia") c.push("acesso: 1 dia");
  if ((t.situacao_padrao || "Confirmado") !== "Confirmado") c.push(`entra como ${String(t.situacao_padrao).toLowerCase()}`);
  if (Number(t.max_por_compra) > 0) c.push(`máx ${t.max_por_compra}/compra`);
  if (t.pagina_inscritos) c.push("página de inscritos");
  if (t.termo?.on) c.push("termo de adesão");
  return c.length ? `<span class="cel-sub">${c.map(esc).join(" · ")}</span>` : "";
}

function editar(t) {
  abrirModal({
    titulo: t ? "Editar tipo de ingresso" : "Novo tipo de ingresso",
    textoConfirmar: t ? "Salvar" : "Criar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required value="${esc(t?.nome || "")}" placeholder="Ex.: VIP, GOLD, 10X LIFE" /></label>
      <label class="campo"><span>Preço</span><input class="input" name="preco" value="${esc(t?.preco || "")}" placeholder="Gratuito, R$ 500,00…" /></label>
      <label class="campo"><span>Vagas (vazio = ilimitado)</span><input class="input" name="vagas" type="number" min="1" value="${t?.vagas ?? ""}" /></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Vendas de</span><input class="input" name="inicio_vendas" type="date" value="${esc(t?.inicio_vendas || "")}" /></label>
        <label class="campo"><span>Vendas até</span><input class="input" name="fim_vendas" type="date" value="${esc(t?.fim_vendas || "")}" /></label>
      </div>
      <label class="campo"><span>Ordem</span><input class="input" name="ordem" type="number" value="${t?.ordem ?? 0}" /></label>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" name="ativo" ${t?.ativo !== false ? "checked" : ""} /> <span style="margin:0">Ativo</span></label>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" name="oculto" ${t?.oculto ? "checked" : ""} /> <span style="margin:0">Oculto (só quem tem o link direto vê)</span></label>

      <div class="secao" style="border-top:1px solid var(--borda);margin-top:6px;padding-top:14px">
        <h4 style="margin:0 0 10px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">Configurações</h4>

        <label class="campo"><span>Situação de quem entra por este tipo</span>
          <select class="select" name="situacao_padrao">
            ${["Confirmado", "Pré-inscrito", "Pendente"].map((s) => `<option ${s === (t?.situacao_padrao || "Confirmado") ? "selected" : ""}>${s}</option>`).join("")}
          </select></label>

        <label class="campo"><span>Acesso ao evento</span>
          <select class="select" name="acesso_dias">
            <option value="todos" ${t?.acesso_dias !== "um_dia" ? "selected" : ""}>Todos os dias, sem restrição</option>
            <option value="um_dia" ${t?.acesso_dias === "um_dia" ? "selected" : ""}>Apenas 1 dia</option>
          </select></label>

        <label class="campo"><span>Quantidade máxima por compra (0 = sem limite)</span>
          <input class="input" name="max_por_compra" type="number" min="0" value="${t?.max_por_compra ?? 0}" /></label>

        <label class="campo" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="lista_espera" ${t?.lista_espera ? "checked" : ""} />
          <span style="margin:0">Lista de espera — ao lotar as vagas, novos entram como “Fila de espera”</span></label>

        <label class="campo" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="pagina_inscritos" ${t?.pagina_inscritos ? "checked" : ""} />
          <span style="margin:0">Habilitar página de visualização de inscritos</span></label>

        <label class="campo" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="termo_on" ${t?.termo?.on ? "checked" : ""} />
          <span style="margin:0">Exibir termo de adesão</span></label>
        <div id="termo-box" ${t?.termo?.on ? "" : "hidden"}>
          <label class="campo"><span>Título do termo</span><input class="input" name="termo_titulo" value="${esc(t?.termo?.titulo || "")}" /></label>
          <label class="campo"><span>Texto do termo</span><textarea class="input" name="termo_texto" rows="3">${esc(t?.termo?.texto || "")}</textarea></label>
        </div>
      </div>`,
    aoMontar: (root) => {
      const chk = root.querySelector('[name="termo_on"]');
      chk.onchange = () => { root.querySelector("#termo-box").hidden = !chk.checked; };
    },
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const termoOn = form.querySelector('[name="termo_on"]').checked;
      const reg = {
        nome: f.nome.trim(),
        preco: f.preco.trim() || null,
        vagas: Number(f.vagas) > 0 ? Number(f.vagas) : null,
        inicio_vendas: f.inicio_vendas || null,
        fim_vendas: f.fim_vendas || null,
        ordem: Number(f.ordem) || 0,
        ativo: form.querySelector('[name="ativo"]').checked,
        oculto: form.querySelector('[name="oculto"]').checked,
        situacao_padrao: f.situacao_padrao || "Confirmado",
        acesso_dias: f.acesso_dias || "todos",
        max_por_compra: Math.max(0, Number(f.max_por_compra) || 0),
        lista_espera: form.querySelector('[name="lista_espera"]').checked,
        pagina_inscritos: form.querySelector('[name="pagina_inscritos"]').checked,
        termo: termoOn
          ? { on: true, titulo: (f.termo_titulo || "").trim(), texto: (f.termo_texto || "").trim() }
          : { on: false },
      };
      if (t) reg.id = t.id;
      const BASE = ["id", "nome", "preco", "vagas", "inicio_vendas", "fim_vendas", "ordem", "ativo", "oculto"];
      try {
        await salvar("tipos_ingresso", reg);
      } catch (e) {
        const msg = e.message || "";
        if (/uidx|duplicate|unique/.test(msg)) {
          toast("Já existe um tipo com esse nome.", "erro");
          return false;
        }
        if (/could not find the .* column|schema cache/i.test(msg)) {
          // colunas de config ainda não existem → salva só o básico
          try {
            await salvar("tipos_ingresso", Object.fromEntries(Object.entries(reg).filter(([k]) => BASE.includes(k))));
            toast("Salvo (sem as configs — rode de novo a migração 0012 no Supabase).", "erro");
            carregar();
            return;
          } catch (e2) { toast(e2.message, "erro"); return false; }
        }
        toast(msg, "erro");
        return false;
      }
      toast("Salvo.", "ok");
      carregar();
    },
  });
}

async function excluir(t) {
  const n = doTipo(t.nome).length;
  const msg = n
    ? `Excluir "${t.nome}"? ${n} participante(s) usam esse tipo — eles continuam na lista, só sem tipo vinculado.`
    : `Excluir "${t.nome}"?`;
  if (!confirmar(msg)) return;
  try {
    await remover("tipos_ingresso", t.id);
    toast("Excluído.", "ok");
    carregar();
  } catch (e) { toast(e.message, "erro"); }
}

async function exportar() {
  const lista = filtrados();
  if (!lista.length) { toast("Nada para exportar.", "erro"); return; }
  await baixarXLSX("tipos-ingresso.xlsx", lista, [
    { rotulo: "Nome", valor: (t) => t.nome },
    { rotulo: "Preço", valor: (t) => t.preco || "Gratuito" },
    { rotulo: "Vagas", valor: (t) => (t.vagas ?? "ilimitado") },
    { rotulo: "Inscritos ativos", valor: (t) => analise(t.nome).ativos },
    { rotulo: "Total", valor: (t) => analise(t.nome).total },
    { rotulo: "Vendas de", valor: (t) => (t.inicio_vendas ? formatarData(t.inicio_vendas + "T12:00:00") : "") },
    { rotulo: "Vendas até", valor: (t) => (t.fim_vendas ? formatarData(t.fim_vendas + "T12:00:00") : "") },
    { rotulo: "Ativo", valor: (t) => (t.ativo ? "Sim" : "Não") },
  ]);
  toast("Arquivo gerado.", "ok");
}
