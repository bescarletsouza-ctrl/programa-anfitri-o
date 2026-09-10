// =============================================================================
// Check-in mobile — app de câmera para ler o QR do crachá, credenciar e imprimir.
// Página independente (sem sidebar). O evento vem pela URL (?evento=UUID) ou do
// localStorage. Usa as mesmas queries do admin.
// =============================================================================
import { esc, toast } from "./ui.js";
import {
  getEvento, listParticipantes, listCheckins,
  buscarParticipantePorQR, registrarCheckin,
} from "./supabase.js";
import { eventoId, eventoNome, definirEvento } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

const el = (id) => document.getElementById(id);
const AVATAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`;

let scanner = null;
let evento = null;
let participantes = [];
let checkins = [];
let travado = false;      // evita processar 2 scans ao mesmo tempo

/* ---- boot ---------------------------------------------------------------- */
(function boot() {
  const url = new URL(location.href);
  let ev = url.searchParams.get("evento") || "";
  // aceita colar a URL inteira
  const m = ev.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m) ev = m[0];
  if (ev) definirEvento(ev);

  if (eventoId()) {
    iniciar();
  } else {
    el("abrir-msg").textContent = "Abra pelo link gerado em Configurações › Check-in pelo celular.";
    el("form-evento").hidden = false;
  }
  el("form-evento").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el("in-evento").value.trim();
    const id = (v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0] || v;
    if (!id) return;
    definirEvento(id);
    iniciar();
  });
})();

async function iniciar() {
  try {
    evento = await getEvento(eventoId());
    if (!evento) throw new Error("Evento não encontrado.");
  } catch (e) {
    el("abrir-msg").textContent = "Não encontrei esse evento. Confira o link.";
    el("form-evento").hidden = false;
    return;
  }
  el("topo-evento").textContent = evento.nome || "Evento";
  document.title = `Check-in — ${evento.nome || "We.events"}`;

  el("tela-abrir").hidden = true;
  el("app").hidden = false;

  await Promise.all([carregarDados(), abrirCamera()]);
  wire();
}

async function carregarDados() {
  try {
    [participantes, checkins] = await Promise.all([
      listParticipantes().then((a) => a.filter((p) => p.situacao !== "Desativado")),
      listCheckins().catch(() => []),
    ]);
    atualizarContador();
  } catch (e) {
    toast("Falha ao carregar participantes.", "erro");
  }
}

const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const horaCurta = (iso) => {
  try { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return ""; }
};

function atualizarContador() {
  const t0 = hoje0();
  const n = new Set(
    checkins.filter((c) => c.acao === "entrada" && !c.atividade_id && new Date(c.at).getTime() >= t0)
      .map((c) => c.participante_id),
  ).size;
  el("topo-n").textContent = n;
}

/* ---- câmera / scanner -------------------------------------------------- */
async function abrirCamera() {
  await esperarLib();
  el("cam-erro").hidden = true;
  try {
    scanner = scanner || new Html5Qrcode("reader", { verbose: false });
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 236, height: 236 }, aspectRatio: 1 },
      onScan,
      () => {},
    );
    el("mira").hidden = false;
  } catch (e) {
    el("mira").hidden = true;
    el("cam-erro").hidden = false;
  }
}

function esperarLib() {
  return new Promise((res) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.Html5Qrcode || n++ > 60) { clearInterval(t); res(); }
    }, 50);
  });
}

async function pausar() { try { await scanner?.pause(true); } catch {} }
async function retomar() {
  travado = false;
  try { await scanner?.resume(); } catch { abrirCamera(); }
}

async function onScan(texto) {
  if (travado) return;
  travado = true;
  navigator.vibrate?.(60);
  await pausar();
  el("mira-txt").textContent = "Buscando…";
  let p = participantes.find((x) => x.codigo && texto.includes(x.codigo));
  if (!p) {
    try { p = await buscarParticipantePorQR(texto); } catch {}
  }
  el("mira-txt").textContent = "Aponte para o QR Code do crachá";
  if (!p) {
    abrirSheetErro(texto);
    return;
  }
  abrirSheet(p);
}

/* ---- bottom sheet ----------------------------------------------------- */
function jaEntrou(p) {
  const ent = checkins
    .filter((c) => c.participante_id === p.id && !c.atividade_id)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const liquido = ent.reduce((s, c) => s + (c.acao === "entrada" ? 1 : -1), 0);
  return liquido > 0 ? ent.find((c) => c.acao === "entrada") : null;
}

function abrirSheet(p) {
  const entrada = jaEntrou(p);
  const cat = (p.ingresso || p.tipo || "").trim();
  const confirmado = (p.situacao || "Confirmado") === "Confirmado";
  el("sheet").innerHTML = `
    <div class="ck-sheet-puxador"></div>
    <div class="ck-pessoa">
      <div class="ck-avatar">${AVATAR}</div>
      <div class="ck-pessoa-txt">
        <strong>${esc(p.nome || "—")}</strong>
        ${cat ? `<span class="ck-pessoa-cat">${esc(cat)}</span>` : ""}
        <span class="ck-pessoa-cod">${esc(p.codigo || "")}</span>
      </div>
    </div>
    <div class="ck-status">
      <span class="ck-status-linha ${confirmado ? "ok" : "alerta"}">
        ${confirmado ? "✓ Inscrição confirmada" : "• Situação: " + esc(p.situacao || "—")}
      </span>
      <span class="ck-status-linha ${entrada ? "ok" : "neutro"}">
        ${entrada ? `✓ Check-in feito às ${esc(horaCurta(entrada.at))}` : "Ainda não fez check-in"}
      </span>
    </div>
    <div class="ck-sheet-acoes">
      ${entrada ? `
        <button class="ck-btn ck-btn-primario" data-acao="reimprimir">Reimprimir crachá</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Escanear outro</button>
      ` : `
        <button class="ck-btn ck-btn-primario" data-acao="credenciar">Check-in + imprimir crachá</button>
        <button class="ck-btn ck-btn-secundario" data-acao="so-checkin">Só fazer check-in</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Cancelar</button>
      `}
    </div>`;
  mostrarSheet();
  el("sheet").querySelectorAll("[data-acao]").forEach((b) => {
    b.onclick = () => acao(b.dataset.acao, p, b);
  });
}

function abrirSheetErro(texto) {
  el("sheet").innerHTML = `
    <div class="ck-sheet-puxador"></div>
    <div class="ck-erro-icone">!</div>
    <strong class="ck-erro-tit">Crachá não reconhecido</strong>
    <p class="ck-erro-sub">O código lido não corresponde a nenhum participante deste evento.</p>
    <code class="ck-erro-cod">${esc(texto.slice(0, 60))}</code>
    <div class="ck-sheet-acoes">
      <button class="ck-btn ck-btn-primario" data-acao="buscar">Buscar pelo nome</button>
      <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Escanear de novo</button>
    </div>`;
  mostrarSheet();
  el("sheet").querySelector('[data-acao="buscar"]').onclick = () => { fecharSheet(true); abrirBusca(); };
  el("sheet").querySelector('[data-acao="fechar"]').onclick = () => fecharSheet();
}

function mostrarSheet() {
  el("sheet-fundo").hidden = false;
  el("sheet").hidden = false;
  void el("sheet").offsetHeight; // força um layout antes de animar
  setTimeout(() => {
    el("sheet-fundo").classList.add("aberto");
    el("sheet").classList.add("aberto");
  }, 10);
  el("sheet-fundo").onclick = () => fecharSheet();
}

function fecharSheet(semRetomar) {
  el("sheet-fundo").classList.remove("aberto");
  el("sheet").classList.remove("aberto");
  setTimeout(() => { el("sheet-fundo").hidden = true; el("sheet").hidden = true; }, 240);
  if (!semRetomar) retomar();
}

async function acao(tipo, p, btn) {
  if (tipo === "fechar") return fecharSheet();
  if (tipo === "reimprimir") {
    imprimirCracha(p, evento.nome || "");
    fecharSheet();
    return;
  }
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Registrando…";
  try {
    await registrarCheckin(p.id, "entrada", "checkin-mobile");
    checkins.unshift({ participante_id: p.id, acao: "entrada", at: new Date().toISOString(), atividade_id: null });
    p.presente = true;
    atualizarContador();
    if (tipo === "credenciar") imprimirCracha(p, evento.nome || "");
    fecharSheet();
    telaSucesso(p);
  } catch (e) {
    btn.disabled = false; btn.textContent = antes;
    toast(e.message || "Falha ao registrar.", "erro");
  }
}

function telaSucesso(p) {
  const d = document.createElement("div");
  d.className = "ck-sucesso";
  d.innerHTML = `<div class="ck-sucesso-check">✓</div><strong>${esc(p.nome)}</strong><span>credenciado(a)</span>`;
  document.body.appendChild(d);
  void d.offsetHeight;
  setTimeout(() => d.classList.add("aberto"), 10);
  const sair = () => { d.classList.remove("aberto"); setTimeout(() => d.remove(), 250); };
  d.onclick = sair;
  setTimeout(sair, 1600);
}

/* ---- busca manual --------------------------------------------------- */
function abrirBusca() {
  pausar();
  el("tela-busca").hidden = false;
  el("in-busca").value = "";
  el("busca-lista").innerHTML = "";
  el("in-busca").focus();
}
function fecharBusca() {
  el("tela-busca").hidden = true;
  retomar();
}
function renderBusca() {
  const t = el("in-busca").value.trim().toLowerCase();
  if (t.length < 2) { el("busca-lista").innerHTML = ""; return; }
  const achados = participantes
    .filter((p) => `${p.nome} ${p.email || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(t))
    .slice(0, 30);
  el("busca-lista").innerHTML = achados.length
    ? achados.map((p) => {
        const entrada = jaEntrou(p);
        return `<button class="ck-busca-item" data-id="${p.id}">
          <span class="ck-avatar sm">${AVATAR}</span>
          <span class="ck-busca-item-txt">
            <strong>${esc(p.nome)}</strong>
            <span>${esc(p.ingresso || p.tipo || "")}${p.codigo ? " · " + esc(p.codigo) : ""}</span>
          </span>
          ${entrada ? `<span class="ck-tag-ok">✓</span>` : ""}
        </button>`;
      }).join("")
    : `<p class="ck-busca-vazio">Ninguém encontrado.</p>`;
  el("busca-lista").querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => {
      const p = participantes.find((x) => x.id === b.dataset.id);
      el("tela-busca").hidden = true;
      abrirSheet(p);
    };
  });
}

/* ---- wire ---------------------------------------------------------- */
function wire() {
  el("btn-buscar").onclick = abrirBusca;
  el("btn-manual-2").onclick = abrirBusca;
  el("btn-cam-manual").onclick = abrirBusca;
  el("busca-voltar").onclick = fecharBusca;
  el("btn-cam-retry").onclick = abrirCamera;
  let deb;
  el("in-busca").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(renderBusca, 150); });
  // recarrega os check-ins de tempos em tempos (vários celulares no mesmo evento)
  setInterval(() => {
    if (!document.hidden) listCheckins().then((c) => { checkins = c; atualizarContador(); }).catch(() => {});
  }, 20000);
}
