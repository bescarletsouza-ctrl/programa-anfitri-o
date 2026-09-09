// =============================================================================
// Check-in / credenciamento — busca rápida do participante e marca presença.
// Cada credenciamento grava uma linha no histórico (checkins). Ao credenciar,
// abre o crachá para impressão (nome, empresa, categoria, QR).
// =============================================================================
import { iniciarPagina, esc, debounce, toast } from "./ui.js";
import { listParticipantes, listCheckins, registrarCheckin, salvar, remover } from "./supabase.js";
import { eventoNome } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

iniciarPagina("checkin");
const el = (id) => document.getElementById(id);

let participantes = [];
let checkins = [];
let termo = "";

carregar();
el("btn-atualizar").onclick = () => carregar();
el("busca").addEventListener("input", debounce((e) => { termo = e.target.value.trim().toLowerCase(); render(); }, 150));
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    [participantes, checkins] = await Promise.all([
      listParticipantes(),
      listCheckins().catch(() => []),
    ]);
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

const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function hora(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return ""; }
}

// nº de ENTRADAS hoje de um participante (para detectar reentrada)
function entradasHoje(pid) {
  const t0 = hoje0().getTime();
  return checkins.filter((c) => c.participante_id === pid && c.acao === "entrada" && new Date(c.at).getTime() >= t0).length;
}

function render() {
  const total = participantes.length;
  const presentes = participantes.filter((p) => p.presente).length;
  const t0 = hoje0().getTime();
  const entradasDia = checkins.filter((c) => c.acao === "entrada" && new Date(c.at).getTime() >= t0).length;
  el("n-presentes").textContent = presentes;
  el("n-total").textContent = total;
  el("n-hoje").textContent = entradasDia;
  el("checkin-progresso").style.width = total ? Math.round((presentes / total) * 100) + "%" : "0%";

  if (!termo) {
    el("resultados").innerHTML = "";
    el("dica").hidden = false;
    el("dica").textContent = "Digite para localizar o participante.";
    return;
  }

  const achados = participantes
    .filter((p) => {
      const alvo = `${p.nome} ${p.email || ""} ${p.telefone || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase();
      return alvo.includes(termo);
    })
    .slice(0, 30);

  el("dica").hidden = achados.length > 0;
  if (!achados.length) {
    el("dica").textContent = "Ninguém encontrado com esse termo.";
    el("resultados").innerHTML = "";
    return;
  }

  el("resultados").innerHTML = achados.map((p) => cardHtml(p)).join("");
  el("resultados").querySelectorAll(".checkin-item").forEach((row) => {
    const p = participantes.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-credenciar]")?.addEventListener("click", () => acao(p, "entrada"));
    row.querySelector("[data-saida]")?.addEventListener("click", () => acao(p, "saida"));
    row.querySelector("[data-reimprimir]")?.addEventListener("click", () => imprimirCracha(p, eventoNome()));
    row.querySelector("[data-desfazer]")?.addEventListener("click", () => desfazer(p));
  });
}

function cardHtml(p) {
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

async function acao(p, tipo) {
  try {
    const salvo = await registrarCheckin(p.id, tipo);
    Object.assign(p, salvo);
    checkins = await listCheckins().catch(() => checkins);
    render();
    if (tipo === "entrada") {
      toast(`${p.nome} credenciado(a).`, "ok");
      imprimirCracha(p, eventoNome());
    } else {
      toast(`Saída registrada para ${p.nome}.`, "ok");
    }
  } catch (e) {
    toast(e.message, "erro");
  }
}

async function desfazer(p) {
  try {
    const ultimo = checkins.find((c) => c.participante_id === p.id);
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
