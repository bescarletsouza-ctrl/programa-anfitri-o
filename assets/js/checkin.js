// =============================================================================
// Check-in / credenciamento — busca rápida do participante e marca presença.
// Layout: busca grande no centro + trilha lateral com contadores (Presentes /
// Total / Ausentes, que também filtram) e as categorias de ingresso.
// Cada credenciamento grava uma linha no histórico (checkins). Ao credenciar no
// evento, abre o crachá para impressão. Modo atividade (seletor "Credenciar em")
// credencia numa atividade específica — não imprime crachá nem mexe na presença
// geral; categoria não liberada / atividade lotada = alerta, não bloqueia.
// =============================================================================
import { iniciarPagina, esc, debounce, toast } from "./ui.js";
import { listParticipantes, listCheckins, listAtividades, registrarCheckin, salvar, remover } from "./supabase.js";
import { eventoNome } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

iniciarPagina("checkin");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let atividades = [];
let termo = "";
let alvo = "";          // "" = evento; senão id da atividade
let filtroStat = "";    // "" | "presentes" | "ausentes"
let filtroCat = "";     // "" | categoria de ingresso

const SEM_CAT = "Sem categoria";

carregar();
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

  el("resultados").innerHTML = achados.map((p) => (atv ? cardAtvHtml(p, atv) : cardEventoHtml(p))).join("");
  el("resultados").querySelectorAll(".checkin-item").forEach((row) => {
    const p = participantes.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-credenciar]")?.addEventListener("click", () => acao(p, "entrada"));
    row.querySelector("[data-saida]")?.addEventListener("click", () => acao(p, "saida"));
    row.querySelector("[data-reimprimir]")?.addEventListener("click", () => imprimirCracha(p, eventoNome()));
    row.querySelector("[data-desfazer]")?.addEventListener("click", () => desfazer(p));
  });
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
  el("n-presentes").textContent = presentes;
  el("n-total").textContent = atv && atv.vagas ? atv.vagas : total;
  el("n-ausentes").textContent = atv && atv.vagas ? Math.max(0, atv.vagas - presentes) : ausentes;
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

function cardEventoHtml(p) {
  const categoria = p.ingresso || p.tipo;
  const sub = [p.empresa, p.email, p.telefone].filter(Boolean).join(" · ");
  const reentrada = !p.presente && entradasHoje(p.id) > 0;
  return `<div class="checkin-item ${p.presente ? "presente" : ""}" data-id="${p.id}">
    <div class="checkin-item-info">
      <strong>${esc(p.nome)}</strong>
      <span class="checkin-meta">
        <span class="badge ${p.tipo === "Anfitrião" ? "badge-laranja" : "badge-neutro"}">${esc(p.tipo)}</span>
        ${categoria && categoria !== p.tipo ? `<span class="chip-cat">${esc(categoria)}</span>` : ""}
        <span class="chip-codigo">${esc(p.codigo || "—")}</span>
      </span>
      ${sub ? `<span class="checkin-sub">${esc(sub)}</span>` : ""}
      ${reentrada ? `<span class="checkin-reentrada">↻ Reentrada — já esteve presente hoje</span>` : ""}
    </div>
    <div class="checkin-item-acao">
      ${p.presente
        ? `<span class="checkin-ok">✓ Presente desde ${esc(hora(p.checkin_at)) || "hoje"}</span>
           <button class="btn btn-secundario btn-sm" data-reimprimir>Reimprimir crachá</button>
           <button class="btn btn-fantasma btn-sm" data-saida>Registrar saída</button>
           <button class="btn btn-fantasma btn-sm" data-desfazer title="Desfazer check-in">Desfazer</button>`
        : `<button class="btn btn-primario" data-credenciar>Credenciar e imprimir</button>`}
    </div>
  </div>`;
}

function cardAtvHtml(p, atv) {
  const categoria = p.ingresso || p.tipo;
  const sub = [p.empresa, p.email, p.telefone].filter(Boolean).join(" · ");
  const dentro = naAtv(p.id);
  const cats = (atv.categorias || []).filter(Boolean);
  const catLiberada = !cats.length || cats.includes(p.ingresso || p.tipo);
  const lotada = atv.vagas && credenciadosNaAtv(atv.id).length >= atv.vagas;
  const alertas = [];
  if (!catLiberada) alertas.push("⚠ Categoria não liberada nesta atividade");
  if (!dentro && lotada) alertas.push("⚠ Atividade lotada");
  return `<div class="checkin-item ${dentro ? "presente" : ""}" data-id="${p.id}">
    <div class="checkin-item-info">
      <strong>${esc(p.nome)}</strong>
      <span class="checkin-meta">
        <span class="badge ${p.tipo === "Anfitrião" ? "badge-laranja" : "badge-neutro"}">${esc(p.tipo)}</span>
        ${categoria && categoria !== p.tipo ? `<span class="chip-cat">${esc(categoria)}</span>` : ""}
        <span class="chip-codigo">${esc(p.codigo || "—")}</span>
      </span>
      ${sub ? `<span class="checkin-sub">${esc(sub)}</span>` : ""}
      ${alertas.map((a) => `<span class="checkin-reentrada">${a}</span>`).join("")}
    </div>
    <div class="checkin-item-acao">
      ${dentro
        ? `<span class="checkin-ok">✓ Na atividade desde ${esc(hora(dentro.desde)) || "hoje"}</span>
           <button class="btn btn-fantasma btn-sm" data-saida>Registrar saída</button>`
        : `<button class="btn btn-primario" data-credenciar>Credenciar</button>`}
    </div>
  </div>`;
}

async function acao(p, tipo) {
  const atv = atvAtual();
  try {
    const salvo = await registrarCheckin(p.id, tipo, atv ? "atividades" : "checkin", atv?.id || null);
    if (!atv) Object.assign(p, salvo);
    checkins = await listCheckins().catch(() => checkins);
    montarSeletor();
    render();
    if (tipo === "entrada") {
      if (atv) {
        toast(`${p.nome} credenciado(a) em ${atv.nome}.`, "ok");
      } else {
        toast(`${p.nome} credenciado(a).`, "ok");
        imprimirCracha(p, eventoNome());
      }
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
