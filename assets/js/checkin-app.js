// =============================================================================
// Check-in mobile — app de câmera. Fluxo: login (Supabase Auth) → escolher
// evento → escolher tipo (evento geral / atividade) → escanear o QR do crachá,
// credenciar e imprimir a credencial. Página independente (sem sidebar).
// =============================================================================
import { esc, toast } from "./ui.js";
import {
  supabase, listEventos, listParticipantes, listCheckins, listAtividades,
  buscarParticipantePorQR, registrarCheckin,
} from "./supabase.js";
import { eventoId, definirEvento } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

const el = (id) => document.getElementById(id);
const AVATAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`;

const TELAS = ["tela-abrir", "tela-login", "tela-eventos", "tela-modo", "app", "tela-busca"];
let scanner = null;
let camAtiva = false;

let sessao = null;
let eventos = [];
let evento = null;
let atividades = [];
let modo = "";            // "" = evento geral; senão id da atividade
let participantes = [];
let checkins = [];
let travado = false;

/* ---- navegação entre telas ------------------------------------------- */
async function mostrarTela(alvo) {
  TELAS.forEach((t) => { const n = el(t); if (n) n.hidden = t !== alvo; });
  if (alvo === "app") await abrirCamera();
  else await pararCamera();
}

/* ---- boot ----------------------------------------------------------- */
(async function boot() {
  el("form-login").addEventListener("submit", entrar);
  el("btn-sair").onclick = sair;
  el("modo-voltar").onclick = () => mostrarTela("tela-eventos");
  el("btn-trocar").onclick = () => mostrarTela("tela-modo");
  el("btn-buscar").onclick = abrirBusca;
  el("btn-manual-2").onclick = abrirBusca;
  el("btn-cam-manual").onclick = abrirBusca;
  el("busca-voltar").onclick = fecharBusca;
  el("btn-cam-retry").onclick = abrirCamera;
  el("modo-evento-btn").onclick = () => escolherModo("");
  el("modo-atividade-btn").onclick = mostrarAtividades;
  let deb;
  el("in-busca").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(renderBusca, 150); });

  supabase.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_OUT") { sessao = null; mostrarTela("tela-login"); }
  });

  try {
    const { data } = await supabase.auth.getSession();
    sessao = data?.session || null;
  } catch { sessao = null; }

  if (sessao) apósLogin();
  else mostrarTela("tela-login");
})();

/* ---- login -------------------------------------------------------- */
async function entrar(e) {
  e.preventDefault();
  const email = el("login-email").value.trim();
  const senha = el("login-senha").value;
  const btn = el("login-btn");
  el("login-erro").hidden = true;
  btn.disabled = true; btn.textContent = "Entrando…";
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    sessao = data.session;
    apósLogin();
  } catch (err) {
    el("login-erro").hidden = false;
    el("login-erro").textContent = /Invalid login/i.test(err.message)
      ? "E-mail ou senha incorretos."
      : (err.message || "Não foi possível entrar.");
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
}

async function sair() {
  await supabase.auth.signOut().catch(() => {});
  sessao = null;
  mostrarTela("tela-login");
}

async function apósLogin() {
  el("eventos-usuario").textContent = sessao?.user?.email || "";
  await mostrarTela("tela-eventos");
  try {
    eventos = await listEventos();
  } catch (e) {
    el("eventos-lista").innerHTML = `<p class="ck-lista-vazio">Falha ao carregar eventos.<br><small>${esc(e.message || "")}</small></p>`;
    return;
  }
  el("eventos-lista").innerHTML = eventos.length
    ? eventos.map((ev) => `<button class="ck-lista-item" data-id="${ev.id}">
        <span class="ck-lista-item-txt">
          <strong>${esc(ev.nome)}</strong>
          <span>${ev.data_evento ? esc(dataBR(ev.data_evento)) : "sem data"}${ev.local ? " · " + esc(ev.local) : ""}</span>
        </span>
        <span class="ck-chevron">›</span>
      </button>`).join("")
    : `<p class="ck-lista-vazio">Nenhum evento cadastrado.</p>`;
  el("eventos-lista").querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => escolherEvento(b.dataset.id);
  });

  // atalho: link com ?evento= já vai direto pra escolha do tipo
  const alvoUrl = (new URL(location.href).searchParams.get("evento") || "")
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (alvoUrl && eventos.some((e) => e.id === alvoUrl)) escolherEvento(alvoUrl);
}

const dataBR = (iso) => { try { return new Intl.DateTimeFormat("pt-BR").format(new Date(iso + "T12:00")); } catch { return iso; } };

/* ---- evento + modo ------------------------------------------------ */
async function escolherEvento(id) {
  evento = eventos.find((e) => e.id === id);
  if (!evento) return;
  definirEvento(evento.id, evento.nome);
  el("modo-evento").textContent = evento.nome;
  el("modo-atividades").hidden = true;
  await mostrarTela("tela-modo");
  atividades = await listAtividades().catch(() => []);
  el("modo-atividade-btn").hidden = false;
  if (!atividades.length) {
    el("modo-atividade-btn").querySelector("span:last-child span").textContent = "Nenhuma atividade cadastrada neste evento";
  }
}

function mostrarAtividades() {
  if (!atividades.length) { escolherModo(""); return; }
  el("modo-atividades").hidden = false;
  el("modo-atividades-lista").innerHTML = atividades.map((a) => `
    <button class="ck-lista-item" data-atv="${a.id}">
      <span class="ck-lista-item-txt">
        <strong>${esc(a.nome)}</strong>
        <span>${[a.dia ? dataBR(a.dia) : "", [a.inicio, a.fim].filter(Boolean).join("–")].filter(Boolean).join(" · ") || "—"}</span>
      </span>
      <span class="ck-chevron">›</span>
    </button>`).join("");
  el("modo-atividades-lista").querySelectorAll("[data-atv]").forEach((b) => {
    b.onclick = () => escolherModo(b.dataset.atv);
  });
  el("modo-atividades").scrollIntoView({ block: "nearest" });
}

async function escolherModo(m) {
  modo = m;
  const atv = atvAtual();
  el("topo-evento").textContent = evento.nome || "Evento";
  el("topo-ctx").textContent = atv ? `▤ ${atv.nome}` : "◎ Evento geral";
  document.title = `Check-in — ${evento.nome || "We.events"}`;
  await carregarDados();
  await mostrarTela("app");
}

const atvAtual = () => atividades.find((a) => a.id === modo) || null;

async function carregarDados() {
  try {
    [participantes, checkins] = await Promise.all([
      listParticipantes().then((a) => a.filter((p) => p.situacao !== "Desativado")),
      listCheckins().catch(() => []),
    ]);
  } catch {
    toast("Falha ao carregar participantes.", "erro");
  }
}

/* ---- helpers de presença --------------------------------------------- */
const horaCurta = (iso) => {
  try { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return ""; }
};

function saldoAtividade(pid, atvId) {
  const linhas = checkins
    .filter((c) => c.participante_id === pid && c.atividade_id === atvId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const n = linhas.reduce((s, c) => s + (c.acao === "entrada" ? 1 : -1), 0);
  return n > 0 ? linhas.find((c) => c.acao === "entrada") : null;
}
function entradaEvento(p) {
  const linhas = checkins
    .filter((c) => c.participante_id === p.id && !c.atividade_id)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const n = linhas.reduce((s, c) => s + (c.acao === "entrada" ? 1 : -1), 0);
  return n > 0 ? linhas.find((c) => c.acao === "entrada") : null;
}
const credenciadosNaAtv = (atvId) =>
  [...new Set(checkins.filter((c) => c.atividade_id === atvId).map((c) => c.participante_id))]
    .filter((pid) => saldoAtividade(pid, atvId));

/* ---- câmera --------------------------------------------------------- */
function esperarLib() {
  return new Promise((res) => {
    let n = 0;
    const t = setInterval(() => { if (window.Html5Qrcode || n++ > 80) { clearInterval(t); res(); } }, 50);
  });
}
async function abrirCamera() {
  await esperarLib();
  if (camAtiva || !window.Html5Qrcode) return;
  el("cam-erro").hidden = true;
  try {
    scanner = scanner || new Html5Qrcode("reader", { verbose: false });
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 236, height: 236 }, aspectRatio: 1 },
      onScan, () => {},
    );
    camAtiva = true;
    el("mira").hidden = false;
  } catch {
    el("mira").hidden = true;
    el("cam-erro").hidden = false;
  }
}
async function pararCamera() {
  if (!scanner || !camAtiva) return;
  try { await scanner.stop(); } catch {}
  camAtiva = false;
}
async function pausar() { try { await scanner?.pause(true); } catch {} }
async function retomar() { travado = false; try { await scanner?.resume(); } catch { abrirCamera(); } }

async function onScan(texto) {
  if (travado) return;
  travado = true;
  navigator.vibrate?.(60);
  await pausar();
  el("mira-txt").textContent = "Buscando…";
  let p = participantes.find((x) => x.codigo && texto.includes(x.codigo));
  if (!p) { try { p = await buscarParticipantePorQR(texto); } catch {} }
  el("mira-txt").textContent = "Aponte para o QR Code do crachá";
  if (!p) return abrirSheetErro(texto);
  abrirSheet(p);
}

/* ---- bottom sheet -------------------------------------------------- */
function abrirSheet(p) {
  const atv = atvAtual();
  const cat = (p.ingresso || p.tipo || "").trim();
  const confirmado = (p.situacao || "Confirmado") === "Confirmado";
  const entrada = atv ? saldoAtividade(p.id, atv.id) : entradaEvento(p);

  const alertas = [];
  if (atv) {
    if (atv.categorias?.length && !atv.categorias.includes(cat))
      alertas.push("⚠ Categoria não liberada nesta atividade");
    if (atv.vagas && credenciadosNaAtv(atv.id).length >= atv.vagas && !entrada)
      alertas.push("⚠ Atividade lotada");
  }

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
        ${entrada
          ? (atv ? `✓ Na atividade desde ${esc(horaCurta(entrada.at))}` : `✓ Check-in feito às ${esc(horaCurta(entrada.at))}`)
          : (atv ? "Ainda não entrou nesta atividade" : "Ainda não fez check-in")}
      </span>
      ${alertas.map((a) => `<span class="ck-status-linha alerta">${a}</span>`).join("")}
    </div>
    <div class="ck-sheet-acoes">
      ${entrada && atv ? `
        <button class="ck-btn ck-btn-secundario" data-acao="saida-atv">Registrar saída da atividade</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Escanear outro</button>
      ` : entrada ? `
        <button class="ck-btn ck-btn-primario" data-acao="reimprimir">Reimprimir crachá</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Escanear outro</button>
      ` : atv ? `
        <button class="ck-btn ck-btn-primario" data-acao="atv">Credenciar na atividade</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Cancelar</button>
      ` : `
        <button class="ck-btn ck-btn-primario" data-acao="credenciar">Check-in + imprimir crachá</button>
        <button class="ck-btn ck-btn-secundario" data-acao="so-checkin">Só fazer check-in</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Cancelar</button>
      `}
    </div>`;
  mostrarSheet();
  el("sheet").querySelectorAll("[data-acao]").forEach((b) => { b.onclick = () => acao(b.dataset.acao, p, b); });
}

function abrirSheetErro(texto) {
  el("sheet").innerHTML = `
    <div class="ck-sheet-puxador"></div>
    <div class="ck-erro-icone">!</div>
    <strong class="ck-erro-tit">Crachá não reconhecido</strong>
    <p class="ck-erro-sub">O código lido não corresponde a nenhum participante deste evento.</p>
    <code class="ck-erro-cod">${esc(String(texto).slice(0, 60))}</code>
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
  void el("sheet").offsetHeight;
  setTimeout(() => { el("sheet-fundo").classList.add("aberto"); el("sheet").classList.add("aberto"); }, 10);
  el("sheet-fundo").onclick = () => fecharSheet();
}
function fecharSheet(semRetomar) {
  el("sheet-fundo").classList.remove("aberto");
  el("sheet").classList.remove("aberto");
  setTimeout(() => { el("sheet-fundo").hidden = true; el("sheet").hidden = true; }, 240);
  if (!semRetomar && el("app").hidden === false) retomar();
}

async function acao(tipo, p, btn) {
  if (tipo === "fechar") return fecharSheet();
  const atv = atvAtual();
  if (tipo === "reimprimir") { imprimirCracha(p, evento.nome || ""); return fecharSheet(); }

  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Registrando…";
  try {
    if (tipo === "saida-atv") {
      await registrarCheckin(p.id, "saida", "checkin-mobile", atv.id);
      checkins.unshift({ participante_id: p.id, acao: "saida", at: new Date().toISOString(), atividade_id: atv.id });
      fecharSheet();
      toast(`Saída de ${p.nome} registrada.`, "ok");
      return;
    }
    const atvId = tipo === "atv" ? atv.id : null;
    await registrarCheckin(p.id, "entrada", "checkin-mobile", atvId);
    checkins.unshift({ participante_id: p.id, acao: "entrada", at: new Date().toISOString(), atividade_id: atvId });
    if (!atvId) p.presente = true;
    if (tipo === "credenciar") imprimirCracha(p, evento.nome || "");
    fecharSheet();
    telaSucesso(p, atvId ? atv.nome : null);
  } catch (e) {
    btn.disabled = false; btn.textContent = antes;
    toast(e.message || "Falha ao registrar.", "erro");
  }
}

function telaSucesso(p, atvNome) {
  const d = document.createElement("div");
  d.className = "ck-sucesso";
  d.innerHTML = `<div class="ck-sucesso-check">✓</div><strong>${esc(p.nome)}</strong><span>${atvNome ? "credenciado(a) em " + esc(atvNome) : "credenciado(a)"}</span>`;
  document.body.appendChild(d);
  void d.offsetHeight;
  setTimeout(() => d.classList.add("aberto"), 10);
  const sair = () => { d.classList.remove("aberto"); setTimeout(() => d.remove(), 250); };
  d.onclick = sair;
  setTimeout(sair, 1600);
}

/* ---- busca manual ------------------------------------------------- */
function abrirBusca() {
  pausar();
  el("tela-busca").hidden = false;
  el("in-busca").value = "";
  el("busca-lista").innerHTML = "";
  el("in-busca").focus();
}
function fecharBusca() {
  el("tela-busca").hidden = true;
  if (el("app").hidden === false) retomar();
}
function renderBusca() {
  const t = el("in-busca").value.trim().toLowerCase();
  if (t.length < 2) { el("busca-lista").innerHTML = ""; return; }
  const atv = atvAtual();
  const achados = participantes
    .filter((p) => `${p.nome} ${p.email || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(t))
    .slice(0, 30);
  el("busca-lista").innerHTML = achados.length
    ? achados.map((p) => {
        const entrada = atv ? saldoAtividade(p.id, atv.id) : entradaEvento(p);
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
    b.onclick = () => { el("tela-busca").hidden = true; abrirSheet(participantes.find((x) => x.id === b.dataset.id)); };
  });
}

/* ---- atualização periódica dos check-ins ------------------------- */
setInterval(() => {
  if (!document.hidden && evento && el("app").hidden === false) {
    listCheckins().then((c) => { checkins = c; }).catch(() => {});
  }
}, 20000);
