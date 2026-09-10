// =============================================================================
// Check-in / credenciamento — busca rápida do participante e marca presença.
// Layout: busca grande no centro + trilha lateral com contadores (Presentes /
// Total / Ausentes, que também filtram) e as categorias de ingresso.
// Cada credenciamento grava uma linha no histórico (checkins). Ao credenciar no
// evento, abre o crachá para impressão. Modo atividade (seletor "Credenciar em")
// credencia numa atividade específica — não imprime crachá nem mexe na presença
// geral; categoria não liberada / atividade lotada = alerta, não bloqueia.
// =============================================================================
import { iniciarPagina, esc, debounce, toast, icone, abrirMenu } from "./ui.js";
import { listParticipantes, listCheckins, listAtividades, registrarCheckin, salvar, remover } from "./supabase.js";
import { eventoNome } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

const AVATAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`;

const _iniciando = iniciarPagina("checkin");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let atividades = [];
let termo = "";
let alvo = "";          // "" = evento; senão id da atividade
let filtroStat = "";    // "" | "presentes" | "ausentes"
let filtroCat = "";     // "" | categoria de ingresso

const SEM_CAT = "Sem categoria";

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });
el("btn-atualizar").onclick = () => carregar();
el("busca").addEventListener("input", debounce((e) => { termo = e.target.value.trim().toLowerCase(); render(); }, 150));
el("alvo").addEventListener("change", (e) => { alvo = e.target.value; filtroStat = ""; render(); });
document.querySelectorAll("[data-fstat]").forEach((b) => {
  b.onclick = () => { filtroStat = filtroStat === b.dataset.fstat ? "" : b.dataset.fstat; render(); };
});
try {
  el("ck-detalhes").checked = localStorage.getItem("ck_detalhes") === "1";
} catch {}
el("ck-detalhes").onchange = (e) => {
  try { localStorage.setItem("ck_detalhes", e.target.checked ? "1" : "0"); } catch {}
  aplicarDetalhes();
};
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    [participantes, checkins, atividades] = await Promise.all([
      listParticipantes(),
      listCheckins().catch(() => []),
      listAtividades().catch(() => []),
    ]);
    participantes = participantes.filter((p) => p.situacao !== "Desativado");
    montarSeletor();
    el("carregando").hidden = true;
    el("painel").hidden = false;
    aplicarDetalhes();
    render();
    el("busca").focus();
  } catch (e) {
    const falta = /participantes|codigo|presente|column/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0006_checkin.sql</code> no SQL Editor do Supabase para ativar o check-in.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

function aplicarDetalhes() {
  el("ck-layout").classList.toggle("sem-detalhes", !el("ck-detalhes").checked);
}

function montarSeletor() {
  const wrap = el("alvo-wrap");
  if (!atividades.length) { wrap.hidden = true; alvo = ""; return; }
  wrap.hidden = false;
  if (alvo && !atividades.some((a) => a.id === alvo)) alvo = "";
  el("alvo").innerHTML =
    `<option value="">Evento — credenciamento geral</option>` +
    atividades
      .map((a) => {
        const n = credenciadosNaAtv(a.id).length;
        const tot = a.vagas ? ` · ${n}/${a.vagas}` : ` · ${n}`;
        return `<option value="${esc(a.id)}" ${a.id === alvo ? "selected" : ""}>${esc(a.nome)}${tot}</option>`;
      })
      .join("");
}

const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function hora(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return ""; }
}

// nº de ENTRADAS hoje de um participante no evento (para detectar reentrada)
function entradasHoje(pid) {
  const t0 = hoje0().getTime();
  return checkins.filter((c) => c.participante_id === pid && !c.atividade_id && c.acao === "entrada" && new Date(c.at).getTime() >= t0).length;
}

const atvAtual = () => atividades.find((a) => a.id === alvo) || null;
const catDe = (p) => (p.ingresso || "").trim() || SEM_CAT;

// participantes com saldo de entradas > 0 numa atividade (checkins vêm em ordem desc)
function credenciadosNaAtv(atvId) {
  const saldo = new Map();
  for (const c of checkins) {
    if (c.atividade_id !== atvId) continue;
    const v = saldo.get(c.participante_id) || { n: 0, desde: null };
    if (c.acao === "entrada") { v.n++; if (!v.desde) v.desde = c.at; }
    else v.n--;
    saldo.set(c.participante_id, v);
  }
  return [...saldo.entries()].filter(([, v]) => v.n > 0).map(([pid, v]) => ({ pid, desde: v.desde }));
}
function naAtv(pid) {
  return credenciadosNaAtv(alvo).find((x) => x.pid === pid) || null;
}
const estaPresente = (p) => (alvo ? !!naAtv(p.id) : !!p.presente);

function render() {
  const atv = atvAtual();
  renderTrilha(atv);
  renderCategorias();

  const filtrando = termo || filtroStat || filtroCat;
  if (!filtrando) {
    el("resultados").innerHTML = "";
    el("dica").hidden = false;
    el("dica").textContent = "Digite algo para buscar…";
    return;
  }

  let lista = participantes.slice();
  if (filtroCat) lista = lista.filter((p) => catDe(p) === filtroCat);
  if (filtroStat === "presentes") lista = lista.filter(estaPresente);
  if (filtroStat === "ausentes") lista = lista.filter((p) => !estaPresente(p));
  if (termo) {
    lista = lista.filter((p) =>
      `${p.nome} ${p.email || ""} ${p.telefone || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(termo)
    );
  }
  lista.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  const achados = lista.slice(0, 80);

  el("dica").hidden = achados.length > 0;
  if (!achados.length) {
    el("dica").textContent = "Ninguém encontrado.";
    el("resultados").innerHTML = "";
    return;
  }

  el("resultados").className = "ck-cards";
  el("resultados").innerHTML = achados.map((p) => (atv ? cardAtvHtml(p, atv) : cardEventoHtml(p))).join("");
  el("resultados").querySelectorAll(".ck-card").forEach((row) => {
    const p = participantes.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-credenciar]")?.addEventListener("click", () => acao(p, "entrada", true));
    row.querySelector("[data-checkin]")?.addEventListener("click", () => acao(p, "entrada", false));
    row.querySelector("[data-saida]")?.addEventListener("click", () => acao(p, "saida"));
    row.querySelector("[data-reimprimir]")?.addEventListener("click", () => imprimirCracha(p, eventoNome()));
    row.querySelector("[data-desfazer]")?.addEventListener("click", () => desfazer(p));
    row.querySelector("[data-atividades]")?.addEventListener("click", (e) => addAtividade(p, e.currentTarget));
    row.querySelector("[data-mais]")?.addEventListener("click", (e) => {
      const box = row.querySelector(".ck-card-extra");
      box.hidden = !box.hidden;
      e.currentTarget.textContent = box.hidden ? "Ver mais dados ▾" : "Ver menos ▴";
    });
  });
}

// abre um menu com as atividades para credenciar o participante numa delas
async function addAtividade(p, anchor) {
  if (!atividades.length) { toast("Nenhuma atividade cadastrada.", "erro"); return; }
  const itens = atividades.map((a) => ({
    valor: a.id,
    rotulo: `${a.nome}${a.vagas ? ` · ${credenciadosNaAtv(a.id).length}/${a.vagas}` : ""}`,
    atual: !!credenciadosNaAtv(a.id).find((x) => x.pid === p.id),
  }));
  const escolha = await abrirMenu(anchor, itens);
  if (!escolha) return;
  const a = atividades.find((x) => x.id === escolha);
  try {
    await registrarCheckin(p.id, "entrada", "atividades", escolha);
    checkins = await listCheckins().catch(() => checkins);
    montarSeletor();
    render();
    toast(`${p.nome} credenciado(a) em ${a.nome}.`, "ok");
  } catch (e) { toast(e.message, "erro"); }
}

function renderTrilha(atv) {
  const total = participantes.length;
  let presentes, rotuloPres, rotuloTot, rotuloAus, ausentes;
  if (atv) {
    presentes = credenciadosNaAtv(atv.id).length;
    ausentes = Math.max(0, total - presentes);
    rotuloPres = "Credenciados";
    rotuloTot = atv.vagas ? "Vagas" : "Participantes";
    rotuloAus = atv.vagas ? "Vagas livres" : "Fora";
  } else {
    presentes = participantes.filter((p) => p.presente).length;
    ausentes = total - presentes;
    rotuloPres = "Presentes";
    rotuloTot = "Total";
    rotuloAus = "Ausentes";
  }
  const base = atv && atv.vagas ? atv.vagas : total;
  const totalMostrado = base;
  const ausMostrado = atv && atv.vagas ? Math.max(0, atv.vagas - presentes) : ausentes;
  const pct = (n) => (base > 0 ? ` <small>${Math.round((n / base) * 100)}%</small>` : "");
  el("n-presentes").innerHTML = presentes + pct(presentes);
  el("n-total").textContent = totalMostrado;
  el("n-ausentes").innerHTML = ausMostrado + pct(ausMostrado);
  el("lbl-presentes").textContent = rotuloPres;
  el("lbl-total").textContent = rotuloTot;
  el("lbl-ausentes").textContent = rotuloAus;

  document.querySelectorAll("[data-fstat]").forEach((b) => {
    b.classList.toggle("ativo", !!b.dataset.fstat && b.dataset.fstat === filtroStat);
  });
}

function renderCategorias() {
  const mapa = new Map();
  participantes.forEach((p) => {
    const c = catDe(p);
    const m = mapa.get(c) || { total: 0, presentes: 0 };
    m.total++;
    if (estaPresente(p)) m.presentes++;
    mapa.set(c, m);
  });
  const cats = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  const box = el("ck-cats");
  if (!cats.length) { box.innerHTML = `<span class="pagina-sub" style="margin:0;font-size:.75rem">—</span>`; return; }
  box.innerHTML = cats
    .map(([c, m]) => `<button type="button" class="ck-cat ${c === filtroCat ? "ativo" : ""}" data-cat="${esc(c)}">
      <span>${esc(c)}</span>
      <span class="ck-cat-n">${m.presentes}/${m.total}</span>
    </button>`)
    .join("");
  box.querySelectorAll("[data-cat]").forEach((b) => {
    b.onclick = () => { filtroCat = filtroCat === b.dataset.cat ? "" : b.dataset.cat; render(); };
  });
}

// nº de atividades em que o participante está credenciado
const atividadesDoPart = (pid) => atividades.filter((a) => credenciadosNaAtv(a.id).some((x) => x.pid === pid)).length;

function cabecalhoCard(p) {
  const categoria = (p.ingresso || p.tipo || "").trim();
  const nAtv = atividadesDoPart(p.id);
  const extra = [
    p.empresa && ["Empresa", p.empresa],
    p.telefone && ["Telefone", p.telefone],
    p.codigo && ["Código", p.codigo],
    p.faturamento && ["Faturamento", p.faturamento],
    p.quantidade && p.quantidade !== 1 && ["Ingressos", p.quantidade],
  ].filter(Boolean);
  return `
    <div class="ck-card-avatar">${AVATAR}</div>
    <strong class="ck-card-nome">${esc(p.nome)}</strong>
    <div class="ck-card-linha forte">${esc(categoria || "Sem categoria")}</div>
    <div class="ck-card-linha">${nAtv ? `${nAtv} atividade${nAtv > 1 ? "s" : ""} credenciada${nAtv > 1 ? "s" : ""}` : "Nenhuma atividade extra"}</div>
    ${p.email ? `<div class="ck-card-linha">${esc(p.email)}</div>` : ""}
    ${extra.length ? `<button type="button" class="ck-card-mais" data-mais>Ver mais dados ▾</button>
      <div class="ck-card-extra" hidden>${extra.map(([k, v]) => `<div class="ck-card-linha">${esc(k)}: ${esc(v)}</div>`).join("")}</div>` : ""}
    <div class="ck-card-linha ${situ(p) === "Confirmado" ? "ok" : ""}">
      ${situ(p) === "Confirmado" ? "✓ Inscrição confirmada" : esc(situ(p))}
    </div>`;
}
const situ = (p) => p.situacao || "Confirmado";

function cardEventoHtml(p) {
  const reentrada = !p.presente && entradasHoje(p.id) > 0;
  return `<div class="ck-card ${p.presente ? "presente" : ""}" data-id="${p.id}">
    ${cabecalhoCard(p)}
    <div class="ck-card-linha ${p.presente ? "presente-badge" : ""}">
      ${p.presente
        ? `✓ Já fez check-in${hora(p.checkin_at) ? ` às ${esc(hora(p.checkin_at))}` : ""}`
        : "Ainda não entrou"}
    </div>
    ${reentrada ? `<div class="ck-card-linha alerta">↻ Reentrada — já esteve presente hoje</div>` : ""}
    <div class="ck-card-acoes">
      ${p.presente
        ? `<button class="btn btn-secundario btn-sm" data-reimprimir>${icone("baixar")} Reimprimir crachá</button>
           <button class="btn btn-secundario btn-sm" data-saida>Registrar saída</button>
           <button class="btn btn-fantasma btn-sm" data-desfazer>Desfazer check-in</button>`
        : `<button class="btn btn-primario" data-credenciar>${icone("check")} Check-in e imprimir etiqueta</button>
           <button class="btn btn-secundario btn-sm" data-checkin>${icone("check")} Apenas fazer check-in</button>
           <button class="btn btn-secundario btn-sm" data-reimprimir>${icone("baixar")} Reimprimir crachá</button>`}
      ${atividades.length ? `<button class="btn btn-secundario btn-sm" data-atividades>${icone("agenda")} Adicionar em atividade</button>` : ""}
    </div>
  </div>`;
}

function cardAtvHtml(p, atv) {
  const dentro = naAtv(p.id);
  const cats = (atv.categorias || []).filter(Boolean);
  const catLiberada = !cats.length || cats.includes(p.ingresso || p.tipo);
  const lotada = atv.vagas && credenciadosNaAtv(atv.id).length >= atv.vagas;
  const alertas = [];
  if (!catLiberada) alertas.push("⚠ Categoria não liberada nesta atividade");
  if (!dentro && lotada) alertas.push("⚠ Atividade lotada");
  return `<div class="ck-card ${dentro ? "presente" : ""}" data-id="${p.id}">
    ${cabecalhoCard(p)}
    <div class="ck-card-linha ${dentro ? "presente-badge" : ""}">
      ${dentro ? `✓ Na atividade desde ${esc(hora(dentro.desde)) || "hoje"}` : "Fora desta atividade"}
    </div>
    ${alertas.map((a) => `<div class="ck-card-linha alerta">${a}</div>`).join("")}
    <div class="ck-card-acoes">
      ${dentro
        ? `<button class="btn btn-secundario btn-sm" data-saida>Registrar saída</button>`
        : `<button class="btn btn-primario" data-credenciar>${icone("check")} Credenciar na atividade</button>`}
      <button class="btn btn-secundario btn-sm" data-reimprimir>${icone("baixar")} Reimprimir crachá</button>
    </div>
  </div>`;
}

async function acao(p, tipo, imprimir = false) {
  const atv = atvAtual();
  try {
    const salvo = await registrarCheckin(p.id, tipo, atv ? "atividades" : "checkin", atv?.id || null);
    if (!atv) Object.assign(p, salvo);
    checkins = await listCheckins().catch(() => checkins);
    montarSeletor();
    render();
    if (tipo === "entrada") {
      toast(atv ? `${p.nome} credenciado(a) em ${atv.nome}.` : `${p.nome} credenciado(a).`, "ok");
      if (imprimir && !atv) imprimirCracha(p, eventoNome());
    } else {
      toast(`Saída registrada para ${p.nome}.`, "ok");
    }
  } catch (e) {
    toast(e.message, "erro");
  }
}

async function desfazer(p) {
  try {
    const ultimo = checkins.find((c) => c.participante_id === p.id && !c.atividade_id);
    if (ultimo) await remover("checkins", ultimo.id);
    await salvar("participantes", { id: p.id, presente: false, checkin_at: null });
    p.presente = false;
    p.checkin_at = null;
    checkins = await listCheckins().catch(() => checkins);
    render();
    toast("Check-in desfeito.", "ok");
  } catch (e) {
    toast(e.message, "erro");
  }
}
