// =============================================================================
// Automações — lista de regras do evento + editor (quando… se… então…).
// A execução é no banco (trigger, migração 0043); aqui só se cadastra, ordena,
// pausa, aplica aos participantes que já existem e vê o histórico.
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast, confirmar, icone, formatarData } from "./ui.js";
import {
  listAutomacoes, automacaoEstatisticas, automacaoPrevia, automacaoAplicarExistentes,
  listAutomacaoExecucoes, nomesDeParticipantes,
  listGrupos, listTiposIngresso, listEtapasParticipante, listarEquipe, salvar, remover,
} from "./supabase.js";
import {
  CAMPOS, OPS_POR_KIND, TIPOS_ACAO, GATILHOS, SITUACOES, PAGAMENTOS, MODELOS,
  condicaoVazia, acaoVazia, resumo, validar, paraSalvar, rotuloValor,
} from "./automacoes-regras.js";

const _iniciando = iniciarPagina("automacoes");
const el = (id) => document.getElementById(id);

let CTX = null;
let automacoes = [], stats = {};
const lk = { usuarios: [], etapas: [], ingressos: [], tipos: [] }; // listas de apoio (nomes)

_iniciando.then((ctx) => { if (ctx) { CTX = ctx; carregar(); } });
el("btn-nova").onclick = () => editar(null);
el("btn-modelos").onclick = escolherModelo;

async function carregar() {
  try {
    const [autos, grupos, tiposIng, etapas, equipe, est] = await Promise.all([
      listAutomacoes(),
      listGrupos().catch(() => []),
      listTiposIngresso().catch(() => []),
      listEtapasParticipante().catch(() => []),
      CTX?.org?.id ? listarEquipe(CTX.org.id).catch(() => []) : Promise.resolve([]),
      automacaoEstatisticas(),
    ]);
    automacoes = autos;
    stats = est;
    lk.etapas = etapas;
    lk.usuarios = equipe;
    lk.ingressos = [...new Set(tiposIng.map((t) => (t.nome || "").trim()).filter(Boolean))].sort();
    lk.tipos = [...new Set(["Convidado", "Anfitrião", "Acompanhante", "Comprador", "Membro", "Outro",
      ...grupos.map((g) => (g.nome || "").trim())].filter(Boolean))];
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    const falta = /automacoes|schema cache|does not exist/i.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0043_automacoes.sql</code> no SQL Editor do Supabase para ativar esta tela.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

async function recarregar() {
  [automacoes, stats] = await Promise.all([listAutomacoes(), automacaoEstatisticas()]);
  render();
}

/* ---- Lista ---------------------------------------------------------------- */
function render() {
  el("vazio").hidden = automacoes.length !== 0;
  el("lista").innerHTML = automacoes.map(cartao).join("");
  el("lista").querySelectorAll("[data-id]").forEach((box) => {
    const a = automacoes.find((x) => x.id === box.dataset.id);
    const on = (sel, fn) => { const b = box.querySelector(sel); if (b) b.onclick = fn; };
    on("[data-toggle]", () => alternar(a));
    on("[data-editar]", () => editar(a));
    on("[data-excluir]", () => excluir(a));
    on("[data-aplicar]", () => aplicarExistentes(a));
    on("[data-historico]", () => verHistorico(a));
    on("[data-subir]", () => mover(a, -1));
    on("[data-descer]", () => mover(a, 1));
  });
}

function cartao(a, i) {
  const r = resumo(a, lk);
  const s = stats[a.id];
  return `<section class="card" data-id="${a.id}" style="margin-bottom:12px;${a.ativo ? "" : "opacity:.65"}">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong style="font-size:1rem">${esc(a.nome)}</strong>
          <span class="badge ${a.ativo ? "badge-ok" : "badge-neutro"}">${a.ativo ? "Ativa" : "Pausada"}</span>
          <span class="badge badge-info">${esc(r.quando)}</span>
          ${a.parar ? `<span class="badge badge-alerta" title="Depois desta, as automações seguintes não rodam para o mesmo participante">Para as próximas</span>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button class="icone-btn" data-subir title="Subir (roda antes)" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="icone-btn" data-descer title="Descer (roda depois)" ${i === automacoes.length - 1 ? "disabled" : ""}>▼</button>
        <button class="btn btn-sm btn-secundario" data-toggle>${a.ativo ? "Pausar" : "Ativar"}</button>
        <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
        <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
      </div>
    </div>
    <div style="margin-top:12px;display:grid;gap:6px;font-size:.88rem">
      <div><span class="cel-tenue" style="font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.68rem">Se</span>
        ${r.se.map((t) => `<span class="chip-cat" style="margin:2px 6px 2px 4px">${esc(t)}</span>`).join("")}</div>
      <div><span class="cel-tenue" style="font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.68rem">Então</span>
        ${r.entao.map((t) => `<span class="chip-cat" style="margin:2px 6px 2px 4px;background:var(--cor-laranja-suave);color:var(--cor-laranja-forte)">${esc(t)}</span>`).join("")}</div>
    </div>
    <div style="margin-top:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="pagina-sub" style="margin:0;font-size:.78rem">${s
        ? `Rodou <b>${s.total}</b> vez${s.total === 1 ? "" : "es"} nos últimos 30 dias · última em ${esc(formatarData(s.ultima, true))}`
        : "Ainda não rodou nos últimos 30 dias."}</span>
      <span style="display:flex;gap:6px">
        <button class="btn btn-sm btn-fantasma" data-historico>Histórico</button>
        <button class="btn btn-sm btn-secundario" data-aplicar title="Aplica esta regra aos participantes que já existem">Aplicar aos existentes</button>
      </span>
    </div>
  </section>`;
}

/* ---- Ações da lista --------------------------------------------------------- */
async function alternar(a) {
  try {
    await salvar("automacoes", { id: a.id, ativo: !a.ativo });
    toast(a.ativo ? "Automação pausada." : "Automação ativada.", "ok");
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

async function excluir(a) {
  if (!confirmar(`Excluir a automação "${a.nome}"? O histórico dela também é apagado. Quem já foi alterado por ela continua como está.`)) return;
  try {
    await remover("automacoes", a.id);
    toast("Automação excluída.", "ok");
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

async function mover(a, dir) {
  const i = automacoes.findIndex((x) => x.id === a.id), j = i + dir;
  if (j < 0 || j >= automacoes.length) return;
  const lista = [...automacoes];
  [lista[i], lista[j]] = [lista[j], lista[i]];
  try {
    for (let k = 0; k < lista.length; k++) {
      if (lista[k].ordem !== k) await salvar("automacoes", { id: lista[k].id, ordem: k });
    }
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

async function aplicarExistentes(a) {
  try {
    toast("Calculando…");
    const p = await automacaoPrevia(a.id);
    if (!p.mudariam) {
      toast(p.atendem ? `${p.atendem} participante(s) atendem as condições e todos já estão certos.` : "Nenhum participante atende as condições agora.", "ok");
      return;
    }
    if (!confirmar(`${p.atendem} participante(s) atendem as condições e ${p.mudariam} seriam alterados.\n\nAplicar agora? As integrações (ActiveCampaign, n8n…) não são disparadas por esta ação.`)) return;
    const r = await automacaoAplicarExistentes(a.id);
    toast(`${r.alterados} participante(s) alterado(s).`, "ok");
    await recarregar();
  } catch (e) { toast(e.message, "erro"); }
}

const ROTULO_CAMPO_HIST = {
  responsavel_user_id: "Responsável", etapa_id: "Etapa", situacao: "Situação", ingresso: "Categoria", tipo: "Tipo",
};
async function verHistorico(a) {
  let exec = [];
  try { exec = await listAutomacaoExecucoes(a.id, 20); } catch (e) { toast(e.message, "erro"); return; }
  let nomes = {};
  try { (await nomesDeParticipantes([...new Set(exec.map((x) => x.participante_id).filter(Boolean))])).forEach((p) => { nomes[p.id] = p.nome; }); } catch { /* sem nomes */ }
  const val = (campo, v) => (v == null || v === "" ? "—" : rotuloValor(campo, v, lk));
  abrirModal({
    titulo: `Histórico — ${a.nome}`,
    textoConfirmar: "Fechar",
    corpoHtml: exec.length
      ? exec.map((x) => `<div style="padding:9px 0;border-bottom:1px solid var(--cinza-100);font-size:.85rem">
          <div><b>${esc(nomes[x.participante_id] || "Participante removido")}</b>
            <span class="cel-tenue">· ${esc(formatarData(x.em, true))}${x.origem === "retroativo" ? " · aplicado aos existentes" : ""}</span></div>
          ${Object.entries(x.mudancas || {}).map(([campo, m]) =>
            `<div class="pagina-sub" style="margin:2px 0 0;font-size:.78rem">${esc(ROTULO_CAMPO_HIST[campo] || campo)}: ${esc(val(campo, m.de))} → <b>${esc(val(campo, m.para))}</b></div>`).join("")}
        </div>`).join("")
      : `<p class="pagina-sub" style="margin:0">Esta automação ainda não alterou ninguém.</p>`,
    onConfirmar: async () => {},
  });
}

/* ---- Modelos ---------------------------------------------------------------- */
function escolherModelo() {
  const m = abrirModal({
    titulo: "Modelos prontos",
    textoConfirmar: "Fechar",
    corpoHtml: MODELOS.map((x) => `<button type="button" class="integ-card" data-modelo="${x.id}" style="width:100%;margin-bottom:10px">
      <span class="integ-card-nome">${esc(x.titulo)}</span>
      <span class="integ-card-desc">${esc(x.desc)}</span>
      <span class="integ-card-add">${icone("mais")} Usar este modelo</span></button>`).join(""),
    onConfirmar: async () => {},
  });
  m.elemento.querySelectorAll("[data-modelo]").forEach((b) => {
    b.onclick = () => {
      const modelo = MODELOS.find((x) => x.id === b.dataset.modelo);
      m.fechar();
      editar(null, modelo.auto());
    };
  });
}

/* ---- Editor ----------------------------------------------------------------- */
function opcoesDoCampo(campo) {
  if (campo === "tipo") return lk.tipos.map((v) => ({ valor: v, rotulo: v }));
  if (campo === "ingresso") return lk.ingressos.map((v) => ({ valor: v, rotulo: v }));
  if (campo === "situacao") return SITUACOES.map((v) => ({ valor: v, rotulo: v }));
  if (campo === "pagamento") return PAGAMENTOS.map((v) => ({ valor: v, rotulo: v }));
  if (campo === "etapa_id") return lk.etapas.map((e) => ({ valor: e.id, rotulo: e.nome }));
  if (campo === "responsavel_user_id") return lk.usuarios.map((u) => ({ valor: u.user_id, rotulo: u.nome || u.email }));
  return [];
}
const selectHtml = (opcoes, atual, attrs = "", vazio = "Escolha…") =>
  `<select class="select" ${attrs}><option value="">${esc(vazio)}</option>${opcoes
    .map((o) => `<option value="${esc(o.valor)}" ${o.valor === atual ? "selected" : ""}>${esc(o.rotulo)}</option>`).join("")}</select>`;
// valor atual que não está mais na lista (ex.: categoria renomeada) continua aparecendo
const comAtual = (opcoes, atual) =>
  atual && !opcoes.some((o) => o.valor === atual) ? [...opcoes, { valor: atual, rotulo: `${rotuloValor("", atual, lk)} (não existe mais)` }] : opcoes;

function editar(a, rascunho) {
  const base = a || rascunho || { nome: "", gatilho: "atende", condicoes: [], acoes: [acaoVazia("responsavel")], parar: false };
  const est = {
    nome: base.nome || "", gatilho: base.gatilho || "atende", parar: !!base.parar,
    condicoes: JSON.parse(JSON.stringify(base.condicoes || [])),
    acoes: JSON.parse(JSON.stringify(base.acoes?.length ? base.acoes : [acaoVazia("responsavel")])),
  };

  const m = abrirModal({
    titulo: a ? "Editar automação" : "Nova automação",
    textoConfirmar: a ? "Salvar" : "Criar",
    corpoHtml: `
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required value="${esc(est.nome)}" placeholder="Ex.: Categoria GOLD → Maria" /></label>
      <label class="campo"><span>Quando rodar</span>
        <select class="select" name="gatilho">${GATILHOS.map((g) => `<option value="${g.valor}" ${g.valor === est.gatilho ? "selected" : ""}>${esc(g.rotulo)}</option>`).join("")}</select></label>
      <h4 style="margin:14px 0 8px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">Se (todas as condições valem)</h4>
      <div id="ed-conds"></div>
      <button type="button" class="btn btn-fantasma btn-sm" id="ed-add-cond">${icone("mais")} Condição</button>
      <h4 style="margin:18px 0 8px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">Então</h4>
      <div id="ed-acoes"></div>
      <button type="button" class="btn btn-fantasma btn-sm" id="ed-add-acao">${icone("mais")} Ação</button>
      <label class="campo" style="display:flex;gap:8px;align-items:center;margin-top:16px">
        <input type="checkbox" name="parar" ${est.parar ? "checked" : ""} />
        <span style="margin:0">Depois desta, não rodar as próximas automações para o mesmo participante</span></label>
      ${lk.usuarios.length ? "" : `<div class="aviso" style="margin:0">Não consegui carregar a lista de usuários da equipe — as ações de responsável precisam dela.</div>`}`,
    aoMontar: (root) => {
      root.querySelector(".modal").style.width = "min(680px, 100%)";
      const boxC = root.querySelector("#ed-conds"), boxA = root.querySelector("#ed-acoes");

      const desenharConds = () => {
        boxC.innerHTML = est.condicoes.length
          ? est.condicoes.map((c, i) => linhaCondicao(c, i)).join("")
          : `<p class="pagina-sub" style="margin:0 0 8px;font-size:.82rem">Sem condições: a regra vale para <b>todos</b> os participantes.</p>`;
        boxC.querySelectorAll("[data-cond]").forEach((row) => {
          const i = Number(row.dataset.cond), c = est.condicoes[i];
          row.querySelector("[data-campo]").onchange = (e) => { const campo = e.target.value; est.condicoes[i] = { campo, op: OPS_POR_KIND[CAMPOS[campo].kind][0][0], valor: "" }; if (CAMPOS[campo].kind === "simnao") delete est.condicoes[i].valor; desenharConds(); };
          row.querySelector("[data-op]")?.addEventListener("change", (e) => { c.op = e.target.value; c.valor = c.op === "em" ? [] : ""; desenharConds(); });
          row.querySelector("[data-valor]")?.addEventListener("input", (e) => { c.valor = e.target.value; });
          row.querySelector("[data-valor]")?.addEventListener("change", (e) => { c.valor = e.target.value; });
          row.querySelectorAll("[data-multi]").forEach((cb) => cb.addEventListener("change", () => {
            const set = new Set(Array.isArray(c.valor) ? c.valor : []);
            cb.checked ? set.add(cb.value) : set.delete(cb.value);
            c.valor = [...set];
          }));
          row.querySelector("[data-rm]").onclick = () => { est.condicoes.splice(i, 1); desenharConds(); };
        });
      };

      const desenharAcoes = () => {
        boxA.innerHTML = est.acoes.map((x, i) => linhaAcao(x, i)).join("");
        boxA.querySelectorAll("[data-acao]").forEach((row) => {
          const i = Number(row.dataset.acao), x = est.acoes[i];
          row.querySelector("[data-tipo]").onchange = (e) => { est.acoes[i] = acaoVazia(e.target.value); desenharAcoes(); };
          row.querySelectorAll("[data-av]").forEach((campo) => {
            const grava = (e) => { x[e.target.dataset.av] = e.target.value; };
            campo.addEventListener("change", grava);
            campo.addEventListener("input", grava);
          });
          row.querySelector("[data-vazio]")?.addEventListener("change", (e) => { x.somente_se_vazio = e.target.checked; });
          row.querySelectorAll("[data-usuario-cb]").forEach((cb) => cb.addEventListener("change", () => {
            const set = new Set(x.usuarios || []);
            cb.checked ? set.add(cb.value) : set.delete(cb.value);
            x.usuarios = [...set];
          }));
          row.querySelector("[data-rm]").onclick = () => {
            if (est.acoes.length === 1) { toast("A automação precisa de pelo menos uma ação.", "erro"); return; }
            est.acoes.splice(i, 1); desenharAcoes();
          };
        });
      };

      root.querySelector("#ed-add-cond").onclick = () => { est.condicoes.push(condicaoVazia()); desenharConds(); };
      root.querySelector("#ed-add-acao").onclick = () => { est.acoes.push(acaoVazia("responsavel")); desenharAcoes(); };
      desenharConds();
      desenharAcoes();
    },
    onConfirmar: async (form) => {
      est.nome = form.querySelector('[name="nome"]').value;
      est.gatilho = form.querySelector('[name="gatilho"]').value;
      est.parar = form.querySelector('[name="parar"]').checked;
      const erro = validar(est);
      if (erro) { toast(erro, "erro"); return false; }
      if (!est.condicoes.length && !confirmar("Esta automação não tem condições: ela vai valer para TODOS os participantes novos. Continuar?")) return false;
      const reg = paraSalvar(est);
      if (a) reg.id = a.id; else reg.ordem = automacoes.length;
      await salvar("automacoes", reg);
      toast(a ? "Automação salva." : "Automação criada.", "ok");
      await recarregar();
      if (!a) toast("Dica: use “Aplicar aos existentes” se quiser que ela valha também para quem já está na lista.");
    },
  });
  return m;
}

function linhaCondicao(c, i) {
  const def = CAMPOS[c.campo] || CAMPOS.ingresso;
  const camposOpc = Object.entries(CAMPOS).map(([v, d]) => ({ valor: v, rotulo: d.rotulo }));
  const ops = OPS_POR_KIND[def.kind].map(([v, r]) => ({ valor: v, rotulo: r }));
  let controle = "";
  if (def.kind === "simnao") {
    controle = `<select class="select" data-op style="flex:1 1 110px;width:auto;min-width:0">${ops.map((o) => `<option value="${o.valor}" ${o.valor === c.op ? "selected" : ""}>${o.rotulo}</option>`).join("")}</select>`;
  } else {
    const opSel = `<select class="select" data-op style="flex:1 1 120px;width:auto;min-width:0">${ops.map((o) => `<option value="${o.valor}" ${o.valor === c.op ? "selected" : ""}>${esc(o.rotulo)}</option>`).join("")}</select>`;
    let valor = "";
    if (c.op === "vazio" || c.op === "preenchido") valor = "";
    else if (c.op === "em") {
      const marcados = new Set(Array.isArray(c.valor) ? c.valor : []);
      const op = comAtualLista(opcoesDoCampo(c.campo), [...marcados]);
      valor = `<div class="integ-checks" style="flex:2 1 220px">${op.length
        ? op.map((o) => `<label><input type="checkbox" data-multi value="${esc(o.valor)}" ${marcados.has(o.valor) ? "checked" : ""} /> ${esc(o.rotulo)}</label>`).join("")
        : `<span class="cel-tenue">Nenhuma opção cadastrada.</span>`}</div>`;
    } else if (def.kind === "texto") {
      valor = `<input class="input" data-valor value="${esc(c.valor ?? "")}" placeholder="Digite o texto" style="flex:2 1 150px;width:auto;min-width:0" />`;
    } else {
      const opcoes = comAtual(opcoesDoCampo(c.campo), c.valor);
      valor = opcoes.length
        ? selectHtml(opcoes, c.valor, 'data-valor style="flex:2 1 150px;width:auto;min-width:0"')
        : `<input class="input" data-valor value="${esc(c.valor ?? "")}" placeholder="Digite o valor" style="flex:2 1 150px;width:auto;min-width:0" />`;
    }
    controle = opSel + valor;
  }
  return `<div data-cond="${i}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    ${selectHtml(camposOpc, c.campo, 'data-campo style="flex:1.2 1 150px;width:auto;min-width:0"', "Campo").replace('<option value="">Campo</option>', "")}
    ${controle}
    <button type="button" class="icone-btn" data-rm title="Remover condição" style="flex:none">${icone("excluir")}</button>
  </div>`;
}
const comAtualLista = (opcoes, atuais) =>
  atuais.reduce((acc, v) => (v && !acc.some((o) => o.valor === v) ? [...acc, { valor: v, rotulo: `${rotuloValor("", v, lk)} (não existe mais)` }] : acc), opcoes);

function linhaAcao(x, i) {
  const tipos = TIPOS_ACAO.map((t) => `<option value="${t.valor}" ${t.valor === x.tipo ? "selected" : ""}>${esc(t.rotulo)}</option>`).join("");
  const usuarios = lk.usuarios.map((u) => ({ valor: u.user_id, rotulo: u.nome || u.email }));
  const soVazio = `<label style="display:flex;gap:6px;align-items:center;font-size:.8rem;width:100%">
    <input type="checkbox" data-vazio ${x.somente_se_vazio !== false ? "checked" : ""} /> só se o participante estiver sem responsável (não sobrescreve quem já tem)</label>`;
  let corpo = "", extra = ""; // corpo = ao lado do seletor de ação; extra = linha(s) abaixo
  const larg = "flex:2 1 200px;width:auto;min-width:0";
  if (x.tipo === "responsavel") {
    corpo = selectHtml(comAtual(usuarios, x.usuario), x.usuario, `data-av="usuario" style="${larg}"`, "Escolha o usuário");
    extra = soVazio;
  } else if (x.tipo === "responsavel_rodizio") {
    const marcados = new Set(x.usuarios || []);
    extra = `<div class="integ-checks" style="width:100%">${usuarios.map((u) =>
      `<label><input type="checkbox" data-usuario-cb value="${esc(u.valor)}" ${marcados.has(u.valor) ? "checked" : ""} /> ${esc(u.rotulo)}</label>`).join("") || `<span class="cel-tenue">Sem usuários.</span>`}</div>
      <span class="cel-tenue" style="font-size:.74rem;width:100%">Escolha 2 ou mais. Cada novo participante vai para quem tem menos participantes sob responsabilidade neste evento.</span>${soVazio}`;
  } else if (x.tipo === "etapa") {
    corpo = selectHtml(comAtual(opcoesDoCampo("etapa_id"), x.etapa_id), x.etapa_id, `data-av="etapa_id" style="${larg}"`, "Escolha a etapa");
  } else if (x.tipo === "situacao") {
    corpo = selectHtml(SITUACOES.map((v) => ({ valor: v, rotulo: v })), x.valor, `data-av="valor" style="${larg}"`, "Escolha a situação");
  } else if (x.tipo === "ingresso") {
    const op = comAtual(opcoesDoCampo("ingresso"), x.valor);
    corpo = op.length ? selectHtml(op, x.valor, `data-av="valor" style="${larg}"`, "Escolha a categoria")
      : `<input class="input" data-av="valor" value="${esc(x.valor ?? "")}" placeholder="Nome da categoria" style="${larg}" />`;
  } else if (x.tipo === "tipo") {
    corpo = selectHtml(comAtual(opcoesDoCampo("tipo"), x.valor), x.valor, `data-av="valor" style="${larg}"`, "Escolha o tipo");
  }
  return `<div data-acao="${i}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:10px;border:1px solid var(--borda);border-radius:var(--raio)">
    <select class="select" data-tipo style="flex:1.4 1 240px;width:auto;min-width:0">${tipos}</select>
    ${corpo}
    <button type="button" class="icone-btn" data-rm title="Remover ação" style="flex:none;margin-left:auto">${icone("excluir")}</button>
    ${extra}
  </div>`;
}
