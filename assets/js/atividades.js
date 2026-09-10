// =============================================================================
// Atividades — cadastro de palestras/sessões (horário, vagas, categorias
// liberadas) e painel de quem está credenciado em cada uma. O credenciamento
// em si é feito na tela de Check-in (modo atividade).
// =============================================================================
import { iniciarPagina, esc, icone, toast, confirmar, abrirModal, abrirGaveta, debounce } from "./ui.js";
import { listAtividades, listCheckins, listParticipantes, salvar, remover, registrarCheckin, inserirLote } from "./supabase.js";

iniciarPagina("atividades");
const el = (id) => document.getElementById(id);

let atividades = [];
let checkins = [];
let participantes = [];

carregar();
el("btn-atualizar").onclick = () => carregar();
el("nova-atividade").onclick = () => editar(null);

async function carregar() {
  try {
    [atividades, checkins, participantes] = await Promise.all([
      listAtividades(),
      listCheckins().catch(() => []),
      listParticipantes().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    const falta = /atividades|atividade_id|schema cache|does not exist/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0009_atividades.sql</code> no SQL Editor do Supabase para ativar as atividades.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

const hora = (iso) => {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
};

function diaLabel(d) {
  if (!d) return "";
  const [a, m, dd] = String(d).split("-");
  return dd ? `${dd}/${m}/${a}` : String(d);
}

function horarioLinha(atv) {
  const faixa = [atv.inicio, atv.fim].filter(Boolean).join("–");
  return [diaLabel(atv.dia), faixa].filter(Boolean).join(" · ") || "Sem horário definido";
}

// participantes com entrada "líquida" (entradas − saídas > 0) em uma atividade
function credenciadosDe(atvId) {
  const estado = new Map(); // pid → { saldo, desde, p }
  // checkins vem em ordem decrescente de data
  for (const c of checkins) {
    if (c.atividade_id !== atvId) continue;
    const cur = estado.get(c.participante_id) || { saldo: 0, desde: null, p: c.participante || {} };
    if (c.acao === "entrada") { cur.saldo++; if (!cur.desde) cur.desde = c.at; }
    else cur.saldo--;
    estado.set(c.participante_id, cur);
  }
  return [...estado.entries()]
    .filter(([, v]) => v.saldo > 0)
    .map(([pid, v]) => ({ pid, nome: v.p.nome || "—", categoria: v.p.ingresso || v.p.tipo || "", desde: v.desde }));
}

const categoriasUsadas = () => {
  const s = new Set();
  participantes.forEach((p) => { const c = (p.ingresso || "").trim(); if (c) s.add(c); });
  atividades.forEach((a) => (a.categorias || []).forEach((c) => c && s.add(c)));
  return [...s].sort();
};

function render() {
  el("vazio").hidden = atividades.length > 0;
  el("lista").innerHTML = atividades.map(cardHtml).join("");
  el("lista").querySelectorAll("[data-id]").forEach((card) => {
    const atv = atividades.find((a) => a.id === card.dataset.id);
    card.querySelector("[data-editar]").onclick = () => editar(atv);
    card.querySelector("[data-excluir]").onclick = () => excluir(atv);
    card.querySelector("[data-credenciados]").onclick = () => abrirGavetaAtv(atv, "lista");
    card.querySelector("[data-importar]").onclick = () => abrirGavetaAtv(atv, "add");
  });
}

function cardHtml(atv) {
  const cred = credenciadosDe(atv.id).length;
  const temVagas = Number.isFinite(atv.vagas) && atv.vagas > 0;
  const pct = temVagas ? Math.min(100, Math.round((cred / atv.vagas) * 100)) : 0;
  const lotada = temVagas && cred >= atv.vagas;
  const cats = (atv.categorias || []).filter(Boolean);
  return `<div class="card atv-card" data-id="${atv.id}">
    <div class="barra-topo" style="margin:0 0 10px">
      <div style="min-width:0">
        <h3 style="margin:0 0 3px;text-transform:none;font-size:1rem;letter-spacing:normal;color:var(--texto)">${esc(atv.nome)}</h3>
        <div class="atv-horario">${esc(horarioLinha(atv))}</div>
      </div>
      <span class="linha-acoes">
        <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
        <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
      </span>
    </div>
    <div class="atv-vagas">
      <div class="checkin-num" style="font-size:.86rem">
        <b style="font-size:1.3rem">${cred}</b>
        <span>${temVagas ? `de ${atv.vagas} vagas` : "credenciado(s)"}</span>
        ${lotada ? `<span class="chip-cat" style="background:var(--erro-bg);color:var(--erro)">Lotada</span>` : ""}
      </div>
      ${temVagas ? `<div class="checkin-barra" style="margin-top:6px"><i style="width:${pct}%;background:${lotada ? "var(--erro)" : "var(--ok-solid)"}"></i></div>` : ""}
    </div>
    <div class="atv-cats">
      ${cats.length
        ? cats.map((c) => `<span class="chip-cat">${esc(c)}</span>`).join("")
        : `<span class="cel-tenue" style="font-size:.78rem">Todas as categorias podem entrar</span>`}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-secundario btn-sm" data-credenciados>Ver credenciados</button>
      <button class="btn btn-primario btn-sm" data-importar>+ Adicionar participantes</button>
    </div>
  </div>`;
}

function editar(atv) {
  const cats = (atv?.categorias || []).join(", ");
  abrirModal({
    titulo: atv ? "Editar atividade" : "Nova atividade",
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(atv?.nome || "")}" /></label>
      <label class="campo"><span>Dia</span>
        <input class="input" name="dia" type="date" value="${esc(atv?.dia || "")}" /></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Início</span>
          <input class="input" name="inicio" type="time" value="${esc(atv?.inicio || "")}" /></label>
        <label class="campo"><span>Fim</span>
          <input class="input" name="fim" type="time" value="${esc(atv?.fim || "")}" /></label>
      </div>
      <label class="campo"><span>Vagas (deixe vazio para ilimitado)</span>
        <input class="input" name="vagas" type="number" min="1" value="${atv?.vagas ?? ""}" /></label>
      <label class="campo"><span>Categorias que podem entrar (separe por vírgula; vazio = todas)</span>
        <input class="input" name="categorias" list="cats-atv" value="${esc(cats)}" placeholder="Ex.: VIP, GOLD" />
        <datalist id="cats-atv">${categoriasUsadas().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const registro = {
        nome: f.nome.trim(),
        dia: f.dia || null,
        inicio: f.inicio || null,
        fim: f.fim || null,
        vagas: Number(f.vagas) > 0 ? Number(f.vagas) : null,
        categorias: f.categorias.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (atv) registro.id = atv.id;
      await salvar("atividades", registro);
      toast("Atividade salva.", "ok");
      carregar();
    },
  });
}

async function excluir(atv) {
  if (!confirmar(`Excluir a atividade "${atv.nome}"? Os credenciamentos dela também serão removidos.`)) return;
  try {
    await remover("atividades", atv.id);
    toast("Atividade excluída.", "ok");
    carregar();
  } catch (e) {
    toast(e.message, "erro");
  }
}

/* ---- Gaveta: credenciados / adicionar participantes --------------- */
let gavetaAtv = null;
let gavetaModo = "lista"; // "lista" | "add"
let gavetaBusca = "";
const selecionadosAdd = new Set();

function abrirGavetaAtv(atv, modo) {
  gavetaAtv = atv;
  gavetaModo = modo;
  gavetaBusca = "";
  selecionadosAdd.clear();
  abrirGaveta(
    `${esc(atv.nome)}`,
    `<div class="toggle-abas" style="margin-bottom:14px">
       <button type="button" data-aba="lista" class="${modo === "lista" ? "ativo" : ""}">Credenciados</button>
       <button type="button" data-aba="add" class="${modo === "add" ? "ativo" : ""}">Adicionar</button>
     </div>
     <input class="input" id="ga-busca" placeholder="Buscar…" style="margin-bottom:12px" autocomplete="off" />
     <div id="ga-corpo"></div>`
  );
  const g = document.getElementById("gaveta");
  g.querySelectorAll("[data-aba]").forEach((b) => {
    b.onclick = () => {
      gavetaModo = b.dataset.aba;
      g.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x === b));
      renderGavetaCorpo();
    };
  });
  document.getElementById("ga-busca").addEventListener("input", debounce((e) => {
    gavetaBusca = e.target.value.trim().toLowerCase();
    renderGavetaCorpo();
  }, 150));
  renderGavetaCorpo();
}

function renderGavetaCorpo() {
  gavetaModo === "add" ? renderAdd() : renderLista();
}

function renderLista() {
  const alvo = document.getElementById("ga-corpo");
  if (!alvo || !gavetaAtv) return;
  let linhas = credenciadosDe(gavetaAtv.id);
  if (gavetaBusca) linhas = linhas.filter((l) => `${l.nome} ${l.categoria}`.toLowerCase().includes(gavetaBusca));
  linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!linhas.length) {
    alvo.innerHTML = `<p class="pagina-sub" style="margin:0">${gavetaBusca ? "Ninguém encontrado." : "Ninguém credenciado nesta atividade ainda."}</p>`;
    return;
  }
  alvo.innerHTML = linhas
    .map((l) => `<div class="checkin-item" data-pid="${l.pid}" style="padding:10px 12px">
      <div class="checkin-item-info">
        <strong>${esc(l.nome)}</strong>
        <span class="checkin-meta">
          ${l.categoria ? `<span class="chip-cat">${esc(l.categoria)}</span>` : ""}
          <span class="checkin-ok">✓ desde ${esc(hora(l.desde)) || "hoje"}</span>
        </span>
      </div>
      <div class="checkin-item-acao">
        <button class="btn btn-fantasma btn-sm" data-saida>Registrar saída</button>
      </div>
    </div>`)
    .join("");
  alvo.querySelectorAll("[data-pid]").forEach((row) => {
    row.querySelector("[data-saida]").onclick = () => registrarSaida(row.dataset.pid, row.querySelector("[data-saida]"));
  });
}

function renderAdd() {
  const alvo = document.getElementById("ga-corpo");
  if (!alvo || !gavetaAtv) return;
  const dentro = new Set(credenciadosDe(gavetaAtv.id).map((l) => l.pid));
  const cats = (gavetaAtv.categorias || []).filter(Boolean);
  let fora = participantes.filter((p) => !dentro.has(p.id));
  if (gavetaBusca) {
    fora = fora.filter((p) => `${p.nome} ${p.email || ""} ${p.codigo || ""} ${p.ingresso || ""} ${p.tipo || ""}`.toLowerCase().includes(gavetaBusca));
  }
  fora.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  const lista = fora.slice(0, 80);

  const atalhos = cats.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${cats.map((c) => `<button type="button" class="btn btn-secundario btn-sm" data-cat="${esc(c)}">+ Todos de ${esc(c)}</button>`).join("")}
       </div>`
    : "";

  alvo.innerHTML = `
    ${atalhos}
    <div class="pagina-sub" style="margin:0 0 8px">${fora.length} fora da atividade${fora.length > lista.length ? ` · refine a busca (mostrando ${lista.length})` : ""}</div>
    <div id="ga-add-lista">
      ${lista.map((p) => `<label class="checkin-item" style="padding:9px 12px;cursor:pointer">
        <div class="checkin-item-info" style="flex-direction:row;align-items:center;gap:10px">
          <input type="checkbox" data-add="${p.id}" ${selecionadosAdd.has(p.id) ? "checked" : ""} />
          <span>
            <strong>${esc(p.nome)}</strong>
            <span class="checkin-meta">
              <span class="chip-cat">${esc(p.ingresso || p.tipo || "—")}</span>
              <span class="chip-codigo">${esc(p.codigo || "—")}</span>
            </span>
          </span>
        </div>
      </label>`).join("") || `<p class="pagina-sub" style="margin:0">Todo mundo já está na atividade.</p>`}
    </div>
    <button class="btn btn-primario" id="ga-add-btn" style="margin-top:14px;width:100%">Adicionar selecionados</button>`;

  alvo.querySelectorAll("[data-add]").forEach((cb) => {
    cb.onchange = () => {
      cb.checked ? selecionadosAdd.add(cb.dataset.add) : selecionadosAdd.delete(cb.dataset.add);
      atualizarBotaoAdd();
    };
  });
  alvo.querySelectorAll("[data-cat]").forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.cat;
      participantes.forEach((p) => { if (!dentro.has(p.id) && (p.ingresso || p.tipo) === c) selecionadosAdd.add(p.id); });
      renderAdd();
    };
  });
  document.getElementById("ga-add-btn").onclick = adicionarSelecionados;
  atualizarBotaoAdd();
}

function atualizarBotaoAdd() {
  const btn = document.getElementById("ga-add-btn");
  if (!btn) return;
  const n = selecionadosAdd.size;
  btn.textContent = n ? `Adicionar ${n} à atividade` : "Adicionar selecionados";
  btn.disabled = !n;
}

async function adicionarSelecionados() {
  const ids = [...selecionadosAdd];
  if (!ids.length) return;
  const btn = document.getElementById("ga-add-btn");
  btn.disabled = true;
  try {
    await inserirLote("checkins", ids.map((id) => ({
      participante_id: id, acao: "entrada", origem: "atividades", atividade_id: gavetaAtv.id,
    })));
    selecionadosAdd.clear();
    checkins = await listCheckins().catch(() => checkins);
    gavetaModo = "lista";
    const g = document.getElementById("gaveta");
    g?.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x.dataset.aba === "lista"));
    renderGavetaCorpo();
    render();
    toast(`${ids.length} participante(s) adicionado(s).`, "ok");
  } catch (e) {
    btn.disabled = false;
    toast(e.message, "erro");
  }
}

async function registrarSaida(pid, btn) {
  btn.disabled = true;
  try {
    await registrarCheckin(pid, "saida", "atividades", gavetaAtv.id);
    checkins = await listCheckins().catch(() => checkins);
    renderGavetaCorpo();
    render();
    toast("Saída registrada.", "ok");
  } catch (e) {
    btn.disabled = false;
    toast(e.message, "erro");
  }
}
