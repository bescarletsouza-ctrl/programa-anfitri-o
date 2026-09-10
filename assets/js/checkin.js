// =============================================================================
// Check-in / credenciamento — busca rápida do participante e marca presença.
// Cada credenciamento grava uma linha no histórico (checkins). Ao credenciar no
// evento, abre o crachá para impressão (nome, empresa, categoria, QR).
// Modo atividade (seletor "Credenciar em"): credencia o participante numa
// atividade específica — só registra acesso, não imprime crachá nem mexe na
// presença geral. Categoria não liberada / atividade lotada = alerta, não bloqueia.
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
let alvo = ""; // "" = evento; senão id da atividade

carregar();
el("btn-atualizar").onclick = () => carregar();
el("busca").addEventListener("input", debounce((e) => { termo = e.target.value.trim().toLowerCase(); render(); }, 150));
el("alvo").addEventListener("change", (e) => { alvo = e.target.value; render(); });
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    [participantes, checkins, atividades] = await Promise.all([
      listParticipantes(),
      listCheckins().catch(() => []),
      listAtividades().catch(() => []),
    ]);
    montarSeletor();
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
    el("busca").focus();
  } catch (e) {
    const falta = /participantes|codigo|presente|column/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0006_checkin.sql</code> no SQL Editor do Supabase para ativar o check-in.`
      : "Erro ao carregar: " + esc(e.message);
  }
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

function render() {
  const atv = atvAtual();
  atv ? renderStatsAtv(atv) : renderStatsEvento();

  if (!termo) {
    el("resultados").innerHTML = "";
    el("dica").hidden = false;
    el("dica").textContent = "Digite para localizar o participante.";
    return;
  }

  const achados = participantes
    .filter((p) => {
      const alvoTxt = `${p.nome} ${p.email || ""} ${p.telefone || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase();
      return alvoTxt.includes(termo);
    })
    .slice(0, 30);

  el("dica").hidden = achados.length > 0;
  if (!achados.length) {
    el("dica").textContent = "Ninguém encontrado com esse termo.";
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

function renderStatsEvento() {
  const total = participantes.length;
  const presentes = participantes.filter((p) => p.presente).length;
  const t0 = hoje0().getTime();
  const entradasDia = checkins.filter((c) => !c.atividade_id && c.acao === "entrada" && new Date(c.at).getTime() >= t0).length;
  el("n-presentes").textContent = presentes;
  el("n-rotulo").textContent = `de ${total} presentes · ${entradasDia} check-ins hoje`;
  el("checkin-progresso").style.width = total ? Math.round((presentes / total) * 100) + "%" : "0%";
}

function renderStatsAtv(atv) {
  const n = credenciadosNaAtv(atv.id).length;
  el("n-presentes").textContent = n;
  el("n-rotulo").textContent = atv.vagas
    ? `de ${atv.vagas} vagas nesta atividade`
    : `credenciado(s) nesta atividade`;
  el("checkin-progresso").style.width = atv.vagas ? Math.min(100, Math.round((n / atv.vagas) * 100)) + "%" : "0%";
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
