// =============================================================================
// Check-in mobile — app de câmera. Fluxo: login (Supabase Auth) → escolher
// evento → escolher tipo (evento geral / atividade) → escanear o QR do crachá,
// credenciar e imprimir a credencial. Página independente (sem sidebar).
// =============================================================================
import { esc, toast, debounce } from "./ui.js";
import {
  supabase, listEventos, listParticipantes, listCheckins, listAtividades,
  buscarParticipantePorQR, registrarCheckin, getEvento, salvarEventoPorId,
  meusAcessosEventos, eventosDoNivel, listPontos, listAcessosPontos, registrarAcessoPonto, salvar, remover,
  listInscritosAtividades, inscreverNaAtividade, inscricaoDaAtividade, removerInscritosAtividade, removerCheckinsAtividade,
  listTiposIngresso, cadastrarParticipanteNoApp,
} from "./supabase.js";
import { eventoId, definirEvento, hashSenhaEvento } from "./evento.js";
import { kvSet, kvGet, filaAdd, filaList, filaDel, filaPut } from "./offline.js";
import {
  imprimirCracha, CRACHA_PADRAO, TAMANHOS_CRACHA, snapTamanho, limparConfigCracha,
  appNativo, montarCrachaHtml, qrDataURL,
} from "./cracha.js";

const el = (id) => document.getElementById(id);
const AVATAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/></svg>`;
const ICONE_SOL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICONE_LUA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const TELAS = ["tela-abrir", "tela-login", "tela-eventos", "tela-shell", "app", "tela-busca"];
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
let pontos = [];            // pontos de controle do evento (0047)
let acessos = [];           // entradas/saídas nos pontos (mais recentes primeiro)
let pontosIndisponivel = false;
let pontoModo = null;       // {id, nome, acao} enquanto o scanner lê pra um ponto de controle
let atvAcao = null;         // "entrada" | "saida" | "inscrever" | "inscrever_entrada" quando o scanner age direto numa atividade
let inscritos = [];         // inscritos por atividade (0048)
let tiposIngresso = [];      // categorias de ingresso do evento (pra cadastrar participante)
let inscritosIndisponivel = false;
const ORIGEM_APP = "checkin-mobile";   // entradas/saídas feitas no app; a plataforma grava "atividades" / "atividades-import"
const limparModo = () => { modo = ""; pontoModo = null; atvAcao = null; };
let aba = "part";

/* ---- navegação entre telas ------------------------------------------- */
async function mostrarTela(alvo) {
  TELAS.forEach((t) => { const n = el(t); if (n) n.hidden = t !== alvo; });
  if (alvo === "app") await abrirCamera();
  else await pararCamera();
  garantirHistorico();
}

/* ---- botão físico/gesto de voltar do Android -------------------------
   Sem histórico próprio, o "voltar" do celular fecha o app direto (o
   WebView não tem pra onde voltar). Empilha 1 entrada de histórico
   sempre que sai da tela raiz (evento/login/splash) e, a cada popstate,
   desce um nível na UI (fecha menu/sheet/busca/config, ou volta uma
   tela) — reempilhando se ainda não chegou na raiz, pra funcionar em
   vários toques seguidos. Na raiz, o próximo "voltar" sai do app normal. */
function overlayAberto() {
  return !el("menu").hidden || !el("sheet").hidden || !el("tela-busca").hidden || !el("tela-config").hidden
    || !el("tela-pontos").hidden || !el("tela-registro").hidden || !el("tela-novo").hidden || !el("tela-offline").hidden;
}
function noTopo() {
  const telaRaiz = !el("tela-eventos").hidden || !el("tela-login").hidden || !el("tela-abrir").hidden;
  return telaRaiz && !overlayAberto();
}
let historicoEmpilhado = false;
function garantirHistorico() {
  if (!noTopo() && !historicoEmpilhado) {
    history.pushState(null, "", location.href);
    historicoEmpilhado = true;
  }
}
function voltarUmNivel() {
  if (!el("menu").hidden) return fecharMenu();
  if (!el("sheet").hidden) return fecharSheet();
  if (!el("tela-config").hidden) return fecharConfig();
  if (!el("tela-offline").hidden) return fecharOffline();
  if (!el("tela-novo").hidden) return fecharNovoParticipante();
  if (!el("tela-pontos").hidden) return fecharPontos();
  if (!el("tela-registro").hidden) return fecharRegistro();
  if (!el("tela-busca").hidden) return fecharBusca();
  if (!el("app").hidden) return voltarAoShell();
  if (!el("tela-shell").hidden) return mostrarTela("tela-eventos");
}
window.addEventListener("popstate", () => {
  voltarUmNivel();
  historicoEmpilhado = false;
  garantirHistorico();
});

/* ---- boot ----------------------------------------------------------- */
(async function boot() {
  el("form-login").addEventListener("submit", entrar);
  el("btn-sair").onclick = sair;
  el("btn-trocar").onclick = voltarAoShell;
  el("btn-buscar").onclick = abrirBusca;
  el("btn-manual-2").onclick = abrirBusca;
  el("btn-cam-manual").onclick = abrirBusca;
  el("busca-voltar").onclick = fecharBusca;
  el("fab-scanner").onclick = irParaScanner;
  el("btn-cam-retry").onclick = abrirCamera;
  let deb;
  el("in-busca").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(renderBusca, 150); });

  // shell: abas, lista, controle de acesso, configurações, pontos, registro
  el("shell-menu").onclick = abrirMenu;
  el("shell-atualizar").onclick = recarregarTudo;
  document.querySelectorAll(".ck-tabbar [data-tab]").forEach((b) => { b.onclick = () => irParaAba(b.dataset.tab); });
  el("part-busca").addEventListener("input", debounce(renderParticipantes, 150));
  el("part-fab").onclick = iniciarScanEvento;
  el("ac-ler").onclick = iniciarScanPonto;
  el("ac-ponto").onchange = () => { guardar("ck_ponto", el("ac-ponto").value); renderAcesso(); };
  el("ac-acao").onchange = () => guardar("ck_acao", el("ac-acao").value);
  el("cfg-operador-salvar").onclick = () => { guardar("ck_operador", el("cfg-operador").value.trim()); toast("Operador salvo.", "ok"); };
  el("cfg-atv-add").onchange = (e) => { guardar("ck_atv_add", e.target.checked ? "1" : "0"); toast(e.target.checked ? "Este aparelho pode adicionar pessoas às atividades." : "Este aparelho não adiciona pessoas às atividades.", "ok"); };
  el("atv-dia").onchange = () => { guardar("ck_atv_dia", el("atv-dia").value); guardar("ck_atv", ""); renderAtividades(); };
  el("atv-sel").onchange = () => { guardar("ck_atv", el("atv-sel").value); renderAtividades(); };
  document.querySelectorAll(".ck-subtabs [data-sub]").forEach((b) => { b.onclick = () => { atvSub = b.dataset.sub; renderAtividades(); atualizarAtividadesDoBanco(); }; });
  el("atv-entrada").onclick = () => iniciarScanAtividade("entrada");
  el("atv-saida").onclick = () => iniciarScanAtividade("saida");
  el("atv-add-qr").onclick = () => iniciarScanAtividade("inscrever");
  el("atv-add-qr-checkin").onclick = () => iniciarScanAtividade("inscrever_entrada");
  el("atv-busca").addEventListener("input", debounce(() => { const a = atvSelecionada(); if (a) renderInscritos(a); }, 200));
  el("cfg-item-addpart").onclick = aoTocarAddPart;
  el("cfg-item-offline").onclick = abrirOffline;
  el("rede-pill").onclick = abrirOffline;
  el("offline-voltar").onclick = fecharOffline;
  el("of-manual").onchange = (e) => {
    guardar("ck_offline", e.target.checked ? "1" : "");
    if (!e.target.checked) { OFF.semRede = false; sincronizar(); }
    atualizarIndicadorRede();
    toast(e.target.checked ? "Modo offline ligado: nada é enviado até você desligar." : "Modo offline desligado.", "ok");
  };
  el("of-sync").onclick = async () => {
    if (offlineManual()) { toast("Desligue o modo offline para enviar.", "erro"); return; }
    OFF.semRede = false; await sincronizar(); await contarFila(); renderOffline();
    if (OFF.pendentes === 0 && !estaOffline()) toast("Tudo enviado.", "ok");
  };
  el("of-baixar").onclick = async () => {
    if (estaOffline()) { toast("Precisa de internet para baixar os dados.", "erro"); return; }
    OFF.semRede = false; await recarregarTudo(false); renderOffline();
  };
  el("part-add").onclick = abrirNovoParticipante;
  el("novo-voltar").onclick = fecharNovoParticipante;
  el("np-salvar").onclick = () => salvarNovoParticipante(false);
  el("np-salvar-cred").onclick = () => salvarNovoParticipante(true);
  el("cfg-item-pontos").onclick = abrirPontos;
  el("cfg-item-impressora").onclick = abrirConfig;
  el("cfg-item-tema").onclick = alternarTema;
  el("pontos-voltar").onclick = fecharPontos;
  el("ponto-add").onclick = adicionarPonto;
  el("ponto-novo").addEventListener("keydown", (e) => { if (e.key === "Enter") adicionarPonto(); });
  el("registro-voltar").onclick = fecharRegistro;
  el("registro-filtro-btn").onclick = () => { el("registro-filtros").hidden = !el("registro-filtros").hidden; };
  ["rf-tempo", "rf-acao"].forEach((id) => { el(id).onchange = renderRegistro; });
  el("rf-operador").addEventListener("input", debounce(renderRegistro, 200));
  el("btn-menu").onclick = abrirMenu;
  el("menu-fundo").onclick = fecharMenu;
  el("menu-controle").onclick = () => abrirAba("acesso");
  el("menu-lista").onclick = () => abrirAba("part");
  el("menu-atv").onclick = () => abrirAba("atv");
  el("menu-config").onclick = () => abrirAba("cfg");
  el("menu-registro").onclick = () => { fecharMenu(); abrirRegistro(); };
  el("menu-trocar").onclick = () => { fecharMenu(); fecharOverlays(); mostrarTela("tela-eventos"); };
  el("menu-sair").onclick = () => { fecharMenu(); sair(); };
  el("config-voltar").onclick = fecharConfig;
  el("cfg-salvar").onclick = salvarConfig;
  if (appNativo()) {
    el("cfg-app-nativo").hidden = false;
    el("cfg-app-abrir").onclick = () => window.WeEventsApp.abrirConfig();
  }
  el("btn-tema").onclick = alternarTema;
  el("menu-tema").onclick = alternarTema;
  aplicarTema(temaSalvo() || "dark");

  supabase.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_OUT") { if (estaOffline()) return; sessao = null; mostrarTela("tela-login"); }
  });

  try {
    const { data } = await supabase.auth.getSession();
    sessao = data?.session || null;
  } catch { sessao = null; }
  // sem internet o login não renova: se este aparelho já entrou antes, abre no modo offline com o usuário guardado
  if (!sessao) {
    const guardado = await kvGet("usuario").catch(() => null);
    if (guardado?.email && estaOffline()) sessao = { user: { email: guardado.email }, offline: true };
  } else {
    kvSet("usuario", { email: sessao.user?.email }).catch(() => {});
  }
  contarFila();
  registrarServiceWorker();

  if (sessao) apósLogin();
  else mostrarTela("tela-login");
})();

// deixa o app abrir sem internet (guarda a página e as bibliotecas na primeira vez que abre com rede)
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("/sw-checkin.js", { scope: "/checkin-app.html" }).catch((e) => console.warn("service worker:", e));
}

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
    kvSet("usuario", { email: sessao.user?.email }).catch(() => {});
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
    if (estaOffline()) throw new Error("offline");
    // quem foi restringido só vê os eventos em que tem "Credenciamento" (0046); sem restrição, todos
    eventos = eventosDoNivel(await comTimeout(listEventos(), 15000), await meusAcessosEventos(), "credenciamento");
    kvSet("eventos", { em: Date.now(), eventos }).catch(() => {});
  } catch (e) {
    // sem internet: usa os eventos guardados da última vez que o app abriu com rede
    const guardado = await kvGet("eventos").catch(() => null);
    if (guardado?.eventos?.length && (estaOffline() || ehErroDeRede(e))) {
      eventos = guardado.eventos;
      if (!offlineManual()) OFF.semRede = true;
      atualizarIndicadorRede();
      toast("Sem internet: mostrando os eventos salvos neste aparelho.", "ok");
    } else {
      el("eventos-lista").innerHTML = `<p class="ck-lista-vazio">${estaOffline() ? "Sem internet e este aparelho ainda não baixou nenhum evento.<br><small>Conecte-se uma vez para baixar.</small>" : "Falha ao carregar eventos.<br><small>" + esc(e.message || "") + "</small>"}</p>`;
      return;
    }
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

/* ---- MODO OFFLINE -----------------------------------------------------------------------------------------------
   Tudo que o operador faz (ler QR, credenciar, acessos nos pontos, atividades, cadastrar participante, bloquear) vale NA
   HORA no celular. Com internet vai direto pro banco; sem internet (ou com o modo offline ligado) entra numa FILA local e
   é enviado depois, com a hora original e um id gerado no celular (reenviar não duplica). Os dados do evento ficam
   copiados no aparelho, então ler QR e consultar a lista funcionam sem rede. */
const OFF = { semRede: false, sincronizando: false, pendentes: 0, falhas: 0, baixadoEm: 0 };
const offlineManual = () => lembrado("ck_offline") === "1";
const estaOffline = () => offlineManual() || OFF.semRede || navigator.onLine === false;
const ehErroDeRede = (e) => /failed to fetch|networkerror|network request failed|load failed|fetch failed|tempo esgotado|timed out|aborted|offline/i.test(String(e?.message || e || ""));
const ehErroDeLogin = (e) => /jwt|not authenticated|invalid token|token is expired|\b401\b/i.test(String(e?.message || ""));
const comTimeout = (p, ms = 7000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), ms))]);
const novoId = () => (globalThis.crypto?.randomUUID
  ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

// como cada operação é gravada no banco (usado na hora, quando há rede, e depois pela sincronização)
const EXEC = {
  checkin: (op) => registrarCheckin(op.pid, op.acao, op.origem, op.atv || null, { id: op.uid, at: op.at, evento_id: op.evento_id }),
  acesso: (op) => registrarAcessoPonto(op.ponto, op.pid, op.acao, op.operador, { id: op.uid, at: op.at, evento_id: op.evento_id }),
  inscrever: (op) => inscreverNaAtividade(op.atv, op.pid, op.operador, { id: op.uid, evento_id: op.evento_id }),
  remover_inscrito: async (op) => { await removerInscritosAtividade(op.atv, [op.pid]); await removerCheckinsAtividade(op.atv, [op.pid]); },
  novo_participante: (op) => cadastrarParticipanteNoApp(op.dados, { id: op.pid, evento_id: op.evento_id }),
  bloqueio: (op) => salvar("participantes", { id: op.pid, acesso_bloqueado: op.bloquear, acesso_bloqueado_em: op.bloquear ? op.at : null }),
};
const novaOp = (tipo, dados) => ({ tipo, uid: novoId(), at: new Date().toISOString(), evento_id: evento?.id, ...dados });
function rotuloOp(op) {
  const n = op.nome || "—";
  switch (op.tipo) {
    case "checkin": return op.atv
      ? `${op.acao === "entrada" ? "Entrada" : "Saída"} em atividade · ${n}`
      : `Credenciamento · ${n}`;
    case "acesso": return `${op.acao === "entrada" ? "Check-in" : "Saída"} em ponto de controle · ${n}`;
    case "inscrever": return `Inscrição em atividade · ${n}`;
    case "remover_inscrito": return `Remoção da atividade · ${n}`;
    case "novo_participante": return `Cadastro de participante · ${n}`;
    case "bloqueio": return `${op.bloquear ? "Bloqueio" : "Liberação"} de acesso · ${n}`;
    default: return n;
  }
}

// Executa a operação: online → grava agora; sem rede → vai pra fila (e vale localmente do mesmo jeito)
async function comOffline(op) {
  if (!estaOffline() && OFF.pendentes === 0) {
    try {
      const resultado = await comTimeout(EXEC[op.tipo](op), 7000);
      OFF.semRede = false;
      atualizarIndicadorRede();
      if (OFF.pendentes) sincronizar();
      agendarSnapshot();
      return { fila: false, resultado };
    } catch (e) {
      if (!ehErroDeRede(e)) throw e;   // erro de verdade (permissão, dado inválido…): o operador precisa ver
      OFF.semRede = true;
    }
  }
  await filaAdd(op);
  OFF.pendentes++;
  atualizarIndicadorRede();
  agendarSnapshot();
  if (!estaOffline()) sincronizar();   // já voltou a rede: manda a fila em ordem
  return { fila: true };
}

/* ---- cópia dos dados do evento no aparelho ---- */
let timerSnapshot = null;
function agendarSnapshot() { clearTimeout(timerSnapshot); timerSnapshot = setTimeout(salvarSnapshot, 1500); }
async function salvarSnapshot() {
  if (!evento) return;
  try {
    const em = Date.now();
    await kvSet("evento:" + evento.id, {
      em, evento, participantes, checkins, atividades, inscritos, inscritosIndisponivel, pontos, acessos, pontosIndisponivel, tiposIngresso,
    });
    OFF.baixadoEm = em;
  } catch (e) { console.warn("não consegui guardar a cópia dos dados:", e); }
}
async function aplicarSnapshot() {
  if (!evento) return false;
  const s = await kvGet("evento:" + evento.id).catch(() => null);
  if (!s) return false;
  participantes = s.participantes || []; checkins = s.checkins || []; atividades = s.atividades || [];
  inscritos = s.inscritos || []; pontos = s.pontos || []; acessos = s.acessos || []; tiposIngresso = s.tiposIngresso || [];
  inscritosIndisponivel = !!s.inscritosIndisponivel; pontosIndisponivel = !!s.pontosIndisponivel;
  OFF.baixadoEm = s.em || 0;
  return true;
}

// tabelas opcionais (ainda sem a migração) viram "indisponível"; erro de REDE sobe pra quem chamou
const opcional = (promessa, vazio) => promessa.catch((e) => { if (ehErroDeRede(e)) throw e; return vazio; });
async function buscarTudoDoServidor() {
  const [parts, checks, atvs, tipos, ins, pts] = await Promise.all([
    listParticipantes(), listCheckins(), opcional(listAtividades(), []), opcional(listTiposIngresso(), []),
    opcional(listInscritosAtividades(), null), opcional(Promise.all([listPontos(), listAcessosPontos()]), null),
  ]);
  return {
    participantes: parts.filter((p) => p.situacao !== "Desativado"), checkins: checks, atividades: atvs, tiposIngresso: tipos || [],
    inscritos: ins || [], inscritosIndisponivel: ins === null,
    pontos: pts ? pts[0] : [], acessos: pts ? pts[1] : [], pontosIndisponivel: pts === null,
  };
}

async function recarregarTudo(silencioso, semSync) {
  // 1) o que ficou pendente vai primeiro — senão a cópia nova do servidor apagaria o que foi feito offline
  if (!semSync && !estaOffline()) await sincronizar();
  await contarFila();
  if (estaOffline() || OFF.pendentes > 0) {
    const tem = await aplicarSnapshot();
    if (!tem && !participantes.length) toast("Este evento ainda não foi baixado neste aparelho. Conecte-se à internet uma vez.", "erro");
    renderTudo();
    if (silencioso !== true) toast(estaOffline() ? "Offline: usando os dados salvos neste aparelho." : "Há registros pendentes; mantive os dados do aparelho.", "ok");
    return;
  }
  try {
    const d = await comTimeout(buscarTudoDoServidor(), 25000);
    participantes = d.participantes; checkins = d.checkins; atividades = d.atividades; tiposIngresso = d.tiposIngresso;
    inscritos = d.inscritos; inscritosIndisponivel = d.inscritosIndisponivel;
    pontos = d.pontos; acessos = d.acessos; pontosIndisponivel = d.pontosIndisponivel;
    OFF.semRede = false;
    renderTudo();
    await salvarSnapshot();
    if (silencioso !== true) toast("Dados atualizados.", "ok");
  } catch (e) {
    if (!ehErroDeRede(e)) { toast("Falha ao carregar os dados do evento.", "erro"); console.warn(e); return; }
    OFF.semRede = true;
    await aplicarSnapshot();
    renderTudo();
    toast("Sem internet: usando os dados salvos neste aparelho.", "ok");
  }
  atualizarIndicadorRede();
}

/* ---- sincronização ---- */
async function contarFila() {
  const f = await filaList().catch(() => []);
  OFF.pendentes = f.filter((o) => !o.falha).length;
  OFF.falhas = f.filter((o) => o.falha).length;
  atualizarIndicadorRede();
  return f;
}
async function sincronizar() {
  if (OFF.sincronizando || offlineManual() || navigator.onLine === false) return;
  const fila = (await contarFila()).filter((o) => !o.falha);
  if (!fila.length) return;
  OFF.sincronizando = true;
  atualizarIndicadorRede();
  let enviados = 0, caiu = false;
  try {
    for (const op of fila) {
      try {
        await comTimeout(EXEC[op.tipo](op), 20000);
        await filaDel(op.seq);
        enviados++;
      } catch (e) {
        if (ehErroDeRede(e)) { OFF.semRede = true; caiu = true; break; }
        if (ehErroDeLogin(e)) { toast("Entre de novo para enviar os registros pendentes.", "erro"); break; }
        op.falha = String(e?.message || e).slice(0, 200);   // erro de verdade: guarda pra você ver e decidir
        await filaPut(op);
      }
    }
  } finally {
    OFF.sincronizando = false;
    await contarFila();
  }
  if (enviados) {
    if (!caiu) OFF.semRede = false;
    toast(`${enviados} registro(s) enviado(s).`, "ok");
    if (OFF.pendentes === 0) recarregarTudo(true, true);   // traz o que os outros aparelhos fizeram
  }
  atualizarIndicadorRede();
}

window.addEventListener("online", () => { OFF.semRede = false; atualizarIndicadorRede(); sincronizar(); });
window.addEventListener("offline", () => atualizarIndicadorRede());
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });
setInterval(() => { if (OFF.pendentes > 0) sincronizar(); }, 20000);

/* ---- indicador e tela "Modo offline" ---- */
function atualizarIndicadorRede() {
  const pill = el("rede-pill");
  if (!pill) return;
  let texto = "", tom = "";
  if (OFF.falhas) { texto = `⚠ ${OFF.falhas} com erro`; tom = "erro"; }
  else if (OFF.sincronizando) { texto = "Sincronizando…"; tom = "sync"; }
  else if (estaOffline()) { texto = OFF.pendentes ? `Offline · ${OFF.pendentes} pendente(s)` : "Offline"; tom = "off"; }
  else if (OFF.pendentes) { texto = `${OFF.pendentes} pendente(s)`; tom = "sync"; }
  pill.hidden = !texto;
  pill.textContent = texto;
  pill.dataset.tom = tom;
  const est = el("cfg-offline-estado");
  if (est) est.textContent = offlineManual() ? "Ligado" : estaOffline() ? "Sem rede" : "Online";
  if (!el("tela-offline").hidden) renderOffline();
}

function abrirOffline() { el("tela-offline").hidden = false; renderOffline(); garantirHistorico(); }
function fecharOffline() { el("tela-offline").hidden = true; }
async function renderOffline() {
  const fila = await filaList().catch(() => []);
  el("of-estado").textContent = offlineManual() ? "Modo offline ligado (não usa a internet)" : estaOffline() ? "Sem internet no momento" : "Online";
  el("of-manual").checked = offlineManual();
  el("of-baixado").textContent = OFF.baixadoEm
    ? `${fmtDataHora(new Date(OFF.baixadoEm).toISOString())} · ${participantes.length} participantes`
    : "Ainda não baixados neste aparelho";
  const pend = fila.filter((o) => !o.falha), falhas = fila.filter((o) => o.falha);
  el("of-pend").textContent = pend.length ? `${pend.length} registro(s) esperando para enviar` : "Nada pendente";
  el("of-fila").innerHTML =
    falhas.map((o) => `<div class="ck-reg-item"><div><strong>${esc(rotuloOp(o))}</strong><span style="color:#f87171">Não foi aceito: ${esc(o.falha)}</span></div>
        <button class="ck-mini perigo" data-descartar="${o.seq}">Descartar</button></div>`).join("") +
    pend.slice(0, 40).map((o) => `<div class="ck-reg-item"><div><strong>${esc(rotuloOp(o))}</strong><span>${esc(fmtDataHora(o.at))}</span></div></div>`).join("") +
    (pend.length > 40 ? `<p class="pagina-sub-ck">… e mais ${pend.length - 40}.</p>` : "");
  el("of-fila").querySelectorAll("[data-descartar]").forEach((b) => {
    b.onclick = async () => { await filaDel(Number(b.dataset.descartar)); await contarFila(); renderOffline(); };
  });
}

/* ---- evento + shell ------------------------------------------------ */
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lembrado = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const operador = () => lembrado("ck_operador") || (sessao?.user?.email || "").split("@")[0];

async function escolherEvento(id) {
  evento = eventos.find((e) => e.id === id);
  if (!evento) return;
  definirEvento(evento.id, evento.nome);
  document.title = `Check-in — ${evento.nome || "We.events"}`;
  el("shell-evento").textContent = evento.nome || "";
  limparModo();
  el("part-lista").innerHTML = `<p class="ck-busca-vazio">Carregando…</p>`;
  await mostrarTela("tela-shell");
  irParaAba("part");
  await recarregarTudo(true);
}

function renderTudo() { renderParticipantes(); renderAcesso(); renderAtividades(); renderConfig(); renderAddPart(); }

const TITULOS_ABA = { part: "Lista de participantes", acesso: "Controle de acesso", atv: "Atividades", cfg: "Configurações" };
function irParaAba(tab) {
  aba = tab;
  ["part", "acesso", "atv", "cfg"].forEach((t) => { el("pane-" + t).hidden = t !== tab; });
  document.querySelectorAll(".ck-tabbar [data-tab]").forEach((b) => b.classList.toggle("ativa", b.dataset.tab === tab));
  el("shell-titulo").textContent = TITULOS_ABA[tab];
  if (tab === "part") renderParticipantes();
  if (tab === "acesso") renderAcesso();
  if (tab === "atv") { renderAtividades(); atualizarAtividadesDoBanco(); }
  if (tab === "cfg") renderConfig();
}

function fecharOverlays() {
  ["tela-busca", "tela-config", "tela-pontos", "tela-registro", "tela-novo", "tela-offline"].forEach((id) => { el(id).hidden = true; });
  if (!el("menu").hidden) fecharMenu();
  if (!el("sheet").hidden) fecharSheet(true);
}
// de qualquer lugar (menu, scanner, telas por cima): volta pro shell, já na aba pedida
async function abrirAba(tab) {
  limparModo();
  fecharOverlays();
  await mostrarTela("tela-shell");
  irParaAba(tab);
}
async function voltarAoShell() {
  limparModo();
  fecharOverlays();
  await mostrarTela("tela-shell");
  irParaAba(aba);
}

/* ---- aba 1: lista de participantes ----------------------------------- */
function htmlItemParticipante(p, atv) {
  const entrada = atv ? saldoAtividade(p.id, atv.id) : entradaEvento(p);
  const confirmado = (p.situacao || "Confirmado") === "Confirmado";
  return `<button class="ck-busca-item" data-id="${p.id}">
    <span class="ck-avatar sm">${AVATAR}</span>
    <span class="ck-busca-item-txt">
      <strong>${esc(p.nome)}</strong>
      <span>${esc(p.ingresso || p.tipo || "")}</span>
      <span class="ck-busca-sit ${confirmado ? "ok" : "alerta"}">${esc(p.situacao || "Confirmado")}</span>
    </span>
    ${entrada ? `<span class="ck-tag-ok">✓</span>` : ""}
  </button>`;
}
function renderParticipantes() {
  const t = el("part-busca").value.trim().toLowerCase();
  const base = t
    ? participantes.filter((p) => `${p.nome} ${p.email || ""} ${p.telefone || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(t))
    : [...participantes].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const achados = base.slice(0, t ? 40 : 300);
  el("part-lista").innerHTML = achados.length
    ? achados.map((p) => htmlItemParticipante(p, null)).join("")
    : `<p class="ck-busca-vazio">${t ? "Ninguém encontrado." : "Nenhum participante neste evento."}</p>`;
  el("part-lista").querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => abrirSheet(participantes.find((x) => x.id === b.dataset.id));
  });
}
async function iniciarScanEvento() {
  limparModo();
  el("topo-evento").textContent = evento?.nome || "Evento";
  el("topo-ctx").textContent = "◎ Credenciamento";
  await mostrarTela("app");
}

/* ---- aba 2: controle de acesso (pontos de controle) ------------------- */
async function carregarPontos() {
  try {
    [pontos, acessos] = await Promise.all([listPontos(), listAcessosPontos()]);
    pontosIndisponivel = false;
  } catch (e) {
    pontos = []; acessos = [];
    pontosIndisponivel = /pontos_controle|acessos_pontos|does not exist|schema cache/i.test(e.message || "");
    if (!pontosIndisponivel) toast("Falha ao carregar os pontos de controle.", "erro");
  }
}
const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const diaSP = (iso) => { try { return FMT_DIA.format(new Date(iso)); } catch { return ""; } };const hojeSP = () => diaSP(new Date().toISOString());
// saldo de cada pessoa no ponto NO DIA: entradas − saídas (> 0 = está dentro). Só conta hoje.
function saldosDoPonto(pontoId, dia = hojeSP()) {
  const m = new Map();
  acessos.forEach((a) => {
    if (a.ponto_id !== pontoId || diaSP(a.at) !== dia) return;
    m.set(a.participante_id, (m.get(a.participante_id) || 0) + (a.acao === "entrada" ? 1 : -1));
  });
  return m;
}
const estaDentro = (pid, pontoId) => (saldosDoPonto(pontoId).get(pid) || 0) > 0;
const quantosDentro = (pontoId) => [...saldosDoPonto(pontoId).values()].filter((n) => n > 0).length;
// check-ins ÚNICOS do dia no ponto: cada pessoa conta uma vez, mesmo que bipe de novo
const checkinsUnicosHoje = (pontoId) =>
  new Set(acessos.filter((a) => a.ponto_id === pontoId && a.acao === "entrada" && diaSP(a.at) === hojeSP()).map((a) => a.participante_id)).size;
const FMT_DATAHORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDataHora = (iso) => { try { return FMT_DATAHORA.format(new Date(iso)); } catch { return ""; } };
function renderAcesso() {
  const ativos = pontos.filter((p) => p.ativo);
  const sel = el("ac-ponto");
  const lembrar = lembrado("ck_ponto");
  sel.innerHTML = ativos.length
    ? ativos.map((p) => `<option value="${p.id}" ${p.id === lembrar ? "selected" : ""}>${esc(p.nome)}</option>`).join("")
    : `<option value="">Sem pontos</option>`;
  el("ac-acao").value = lembrado("ck_acao") || "entrada";

  if (pontosIndisponivel) {
    el("ac-resumo").innerHTML = `<p class="pagina-sub-ck" style="grid-column:1/-1;margin:0">Falta ativar o controle de acesso: rode a migração <code>0047_pontos_de_controle.sql</code> no SQL Editor.</p>`;
    el("ac-recentes").innerHTML = "";
    return;
  }
  if (!ativos.length) {
    el("ac-resumo").innerHTML = `<p class="pagina-sub-ck" style="grid-column:1/-1;margin:0">Nenhum ponto de controle. Cadastre em <b>Configurações ▸ Pontos de controle</b> (ex.: Plenária, Foyer).</p>`;
    el("ac-recentes").innerHTML = "";
    return;
  }
  const atual = sel.value;
  el("ac-resumo").innerHTML = `<div><b>${quantosDentro(atual)}</b><span>dentro agora</span></div><div><b>${checkinsUnicosHoje(atual)}</b><span>check-ins únicos hoje</span></div>`;
  const nomePonto = (id) => pontos.find((p) => p.id === id)?.nome || "—";
  const recentes = acessos.filter((a) => a.ponto_id === atual).slice(0, 8);
  el("ac-recentes").innerHTML = recentes.length
    ? recentes.map((a) => `<div class="ck-reg-item"><div><strong>${esc(a.participante?.nome || "—")}</strong><span>${esc(nomePonto(a.ponto_id))} · ${esc(fmtDataHora(a.at))}</span></div>
        <span class="ck-reg-acao ${a.acao}">${a.acao === "entrada" ? "Entrada" : "Saída"}</span></div>`).join("")
    : `<p class="ck-busca-vazio" style="padding:18px">Nenhum registro neste ponto ainda.</p>`;
}

async function iniciarScanPonto() {
  const pt = pontos.find((p) => p.id === el("ac-ponto").value);
  if (!pt) { toast("Cadastre um ponto de controle em Configurações.", "erro"); return; }
  const acaoSel = el("ac-acao").value;
  limparModo();
  pontoModo = { id: pt.id, nome: pt.nome, acao: acaoSel };
  el("topo-evento").textContent = evento?.nome || "Evento";
  el("topo-ctx").textContent = `◎ ${pt.nome} · ${acaoSel === "entrada" ? "Entrada" : "Saída"}`;
  await mostrarTela("app");
}

// lê o QR no scanner (ou escolhe pelo nome) com um ponto de controle ativo
function resultadoPonto(p, tom, texto) {
  if (tom !== "ok") navigator.vibrate?.([80, 60, 80]);
  telaSucesso(p, null, { tom, texto });
  setTimeout(retomar, tom === "ok" ? 1100 : 1600);
}

// Regras (a entrada num ponto é o CHECK-IN = controle de acesso; precisa ter sido credenciado antes):
//   verde    → entrada/saída registrada
//   vermelho → fora da lista, desativado, acesso bloqueado ou NÃO CREDENCIADO
//   amarelo  → já entrou (ou, na saída, não consta dentro) — nada é gravado, a contagem não duplica
async function registrarNoPonto(p) {
  const pt = pontoModo;
  if (!pt) return;
  if (p.acesso_bloqueado) return resultadoPonto(p, "erro", "Acesso bloqueado");
  if ((p.situacao || "Confirmado") === "Desativado") return resultadoPonto(p, "erro", "Participante desativado");
  const dentro = estaDentro(p.id, pt.id);
  if (pt.acao === "entrada") {
    const credenciado = !!p.presente || !!entradaEvento(p);
    if (!credenciado) return resultadoPonto(p, "erro", "Não foi credenciado");
    if (dentro) return resultadoPonto(p, "atencao", `Já entrou em ${pt.nome}`);
  } else if (!dentro) {
    return resultadoPonto(p, "atencao", `Não consta dentro de ${pt.nome}`);
  }
  try {
    const op = novaOp("acesso", { ponto: pt.id, pid: p.id, acao: pt.acao, operador: operador(), nome: p.nome });
    await comOffline(op);
    acessos.unshift({ id: op.uid, ponto_id: pt.id, participante_id: p.id, acao: pt.acao, operador: op.operador, at: op.at,
      participante: { nome: p.nome, ingresso: p.ingresso, tipo: p.tipo, codigo: p.codigo } });
    resultadoPonto(p, "ok", pt.acao === "entrada" ? `Check-in em ${pt.nome}` : `Saída de ${pt.nome}`);
  } catch (e) {
    toast(e.message || "Falha ao registrar.", "erro");
    setTimeout(retomar, 1100);
  }
}
/* ---- aba 3: controle de acesso às atividades -------------------------- */
// Neste aparelho, pode adicionar pessoas às atividades? (Configurações) — padrão: sim
const podeAdicionarAtv = () => lembrado("ck_atv_add") !== "0";
// inscrever/adicionar pessoas numa atividade só depois de liberar em Configurações ▸ Adicionar participantes (senha do evento)
const podeInscrever = () => podeAdicionarAtv() && addPartLiberado();
let atvSub = "cred";           // "cred" | "insc"
let inscritoRemovendo = null;  // id da linha pedindo confirmação de remoção

// A plataforma (ou outro aparelho) pode ter inscrito/removido gente: ao abrir a aba Atividades, relê do banco
let atualizandoAtv = false;
async function atualizarAtividadesDoBanco() {
  if (atualizandoAtv || estaOffline() || OFF.pendentes > 0) return;   // offline/pendente: a cópia do aparelho é a verdade
  atualizandoAtv = true;
  try {
    const [ins, chk] = await Promise.all([listInscritosAtividades().catch(() => null), listCheckins().catch(() => null)]);
    if (ins) { inscritos = ins; inscritosIndisponivel = false; }
    if (chk) checkins = chk;
    if (aba === "atv") renderAtividades();
  } finally { atualizandoAtv = false; }
}

async function carregarInscritos() {
  try { inscritos = await listInscritosAtividades(); inscritosIndisponivel = false; }
  catch (e) {
    inscritos = [];
    inscritosIndisponivel = /atividade_inscritos|does not exist|schema cache/i.test(e.message || "");
  }
}

// dia: "" = todos; "_" = atividades sem data; senão AAAA-MM-DD
function atividadesDoDia(dia) {
  return atividades.filter((a) => !dia || (dia === "_" ? !a.dia : a.dia === dia));
}
function atvSelecionada() {
  const id = lembrado("ck_atv");
  const lista = atividadesDoDia(lembrado("ck_atv_dia"));
  return lista.find((a) => a.id === id) || lista[0] || null;
}
// Inscritos de uma atividade = a lista de inscritos + quem a PLATAFORMA adicionou/importou (que antes não tinha lista).
// Quem entrou pelo app sem estar inscrito NÃO vira inscrito. SAIR não tira ninguém da lista: saída é só saída do espaço.
const veioDaPlataforma = (c) => c.origem === "atividades" || c.origem === "atividades-import";
function inscritosDe(atvId) {
  const linhas = inscritos.filter((i) => i.atividade_id === atvId);
  const ids = new Set(linhas.map((i) => i.participante_id));
  checkins.forEach((c) => {
    if (c.atividade_id !== atvId || !veioDaPlataforma(c) || ids.has(c.participante_id)) return;
    ids.add(c.participante_id);
    linhas.push({ id: null, atividade_id: atvId, participante_id: c.participante_id, implicita: true });
  });
  return linhas;
}
const estaInscrito = (pid, atvId) =>
  inscritos.some((i) => i.participante_id === pid && i.atividade_id === atvId)
  || checkins.some((c) => c.participante_id === pid && c.atividade_id === atvId && veioDaPlataforma(c));
const atividadesDe = (pid) => atividades.filter((a) => estaInscrito(pid, a.id)).map((a) => a.nome);// última saída da pessoa na atividade (pra mostrar "Saiu às 14:10" sem tirá-la da lista)
const ultimaSaidaAtv = (pid, atvId) =>
  checkins.filter((c) => c.participante_id === pid && c.atividade_id === atvId && c.acao === "saida")
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
// texto pesquisável: nome, contato, código, empresa e qualquer campo personalizado (onde o CPF costuma ficar)
const blobPessoa = (p) => [p.nome, p.email, p.telefone, p.codigo, p.empresa, p.cpf,
  ...Object.values(p.campos_extra || {}).flat()].filter((x) => x != null).join(" ").toLowerCase();
const soDigitos = (s) => String(s || "").replace(/\D/g, "");

function renderAtividades() {
  // ---- dia + atividade
  const dias = [...new Set(atividades.map((a) => a.dia || "_"))].sort();
  let dia = lembrado("ck_atv_dia");
  if (dia && !dias.includes(dia)) dia = "";
  el("atv-dia").innerHTML = `<option value="">Todos os dias</option>` +
    dias.map((d) => `<option value="${d}" ${d === dia ? "selected" : ""}>${d === "_" ? "Sem data" : esc(dataBR(d))}</option>`).join("");
  el("atv-dia").hidden = dias.length < 2;
  const lista = atividadesDoDia(dia);
  const atv = atividadesDoDia(dia).find((a) => a.id === lembrado("ck_atv")) || lista[0] || null;
  el("atv-sel").innerHTML = lista.length
    ? lista.map((a) => `<option value="${a.id}" ${atv && a.id === atv.id ? "selected" : ""}>${esc(a.nome)}${a.inicio ? " · " + esc(a.inicio) : ""}</option>`).join("")
    : `<option value="">Nenhuma atividade</option>`;

  // ---- sub-abas
  document.querySelectorAll(".ck-subtabs [data-sub]").forEach((b) => b.classList.toggle("ativa", b.dataset.sub === atvSub));
  el("atv-cred").hidden = atvSub !== "cred";
  el("atv-insc").hidden = atvSub !== "insc";
  if (!atv) {
    el("atv-presentes").textContent = "0";
    ["atv-n-presentes", "atv-n-entradas", "atv-n-saidas"].forEach((id) => { el(id).textContent = "0"; });
    el("atv-hist").innerHTML = `<p class="ck-busca-vazio">${atividades.length ? "Nenhuma atividade neste dia." : "Nenhuma atividade cadastrada neste evento."}</p>`;
    el("atv-insc-lista").innerHTML = "";
    return;
  }

  // ---- credenciamento: números + histórico
  const doAtv = checkins.filter((c) => c.atividade_id === atv.id);
  const presentes = credenciadosNaAtv(atv.id).length;
  el("atv-presentes").textContent = presentes;
  el("atv-presentes-sub").textContent = atv.vagas ? `de ${atv.vagas} vagas · no local neste momento` : "Participantes no local neste momento";
  el("atv-n-presentes").textContent = presentes;
  el("atv-n-entradas").textContent = doAtv.filter((c) => c.acao === "entrada").length;
  el("atv-n-saidas").textContent = doAtv.filter((c) => c.acao === "saida").length;
  const hist = [...doAtv].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
  el("atv-hist").innerHTML = hist.length
    ? hist.map((c) => `<div class="ck-reg-item"><div><strong>${esc(c.participante?.nome || participantes.find((x) => x.id === c.participante_id)?.nome || "—")}</strong>
        <span>${esc(fmtDataHora(c.at))}</span></div>
        <span class="ck-reg-acao ${c.acao}">${c.acao === "entrada" ? "Entrada" : "Saída"}</span></div>`).join("")
    : `<p class="ck-busca-vazio" style="padding:18px">Nenhum acesso registrado ainda.</p>`;

  renderInscritos(atv);
}

function renderInscritos(atv) {
  const pode = podeAdicionarAtv();       // remover da lista
  const podeAdd = podeInscrever();       // adicionar/inscrever (precisa da liberação com senha)
  el("atv-add-botoes").hidden = !podeAdd;
  if (inscritosIndisponivel) {
    el("atv-insc-titulo").textContent = "Inscritos";
    el("atv-insc-lista").innerHTML = `<p class="pagina-sub-ck">Falta ativar a lista de inscritos: rode a migração <code>0048_atividade_inscritos.sql</code> no SQL Editor.</p>`;
    return;
  }
  const termo = el("atv-busca").value.trim().toLowerCase();
  const digitos = soDigitos(termo);
  if (termo) {
    // pesquisa em TODOS os participantes do evento
    const achados = participantes.filter((p) => {
      const b = blobPessoa(p);
      return b.includes(termo) || (digitos.length >= 3 && soDigitos(b).includes(digitos));
    }).slice(0, 40);
    el("atv-insc-titulo").textContent = `Resultado da pesquisa (${achados.length})`;
    el("atv-insc-lista").innerHTML = achados.length
      ? achados.map((p) => {
          const atvs = atividadesDe(p.id);
          const ja = estaInscrito(p.id, atv.id);
          return `<div class="ck-insc-item" data-pid="${p.id}"><div>
              <strong>${esc(p.nome)}</strong>
              <span>${esc(p.telefone || "sem telefone")} · ${esc((p.ingresso || p.tipo || "sem categoria"))}</span>
              <span>${atvs.length ? "Inscrito em: " + esc(atvs.join(", ")) : "Sem atividades"}</span></div>
            ${ja ? `<span class="ck-insc-ok">✓ Inscrito</span>`
                 : podeAdd ? `<button class="ck-mini" data-inscrever>Inscrever</button>` : ""}</div>`;
        }).join("")
      : `<p class="ck-busca-vazio">Ninguém encontrado.</p>`;
    el("atv-insc-lista").querySelectorAll("[data-inscrever]").forEach((b) => {
      b.onclick = async () => {
        const pid = b.closest("[data-pid]").dataset.pid;
        b.disabled = true;
        await inscrever(participantes.find((x) => x.id === pid), atv);
        renderAtividades();
      };
    });
    return;
  }
  const lista = inscritosDe(atv.id)
    .map((i) => ({ i, p: participantes.find((x) => x.id === i.participante_id) }))
    .filter((x) => x.p)
    .sort((a, b) => a.p.nome.localeCompare(b.p.nome, "pt-BR"));
  el("atv-insc-titulo").textContent = `Inscritos (${lista.length}${atv.vagas ? " de " + atv.vagas : ""})`;
  el("atv-insc-lista").innerHTML = lista.length
    ? lista.map(({ i, p }) => {
        const dentro = !!saldoAtividade(p.id, atv.id);
        const saiu = !dentro ? ultimaSaidaAtv(p.id, atv.id) : null;
        return `<div class="ck-insc-item" data-pid="${p.id}"><div>
            <strong>${esc(p.nome)}</strong>
            <span>${esc(p.telefone || "sem telefone")} · ${esc((p.ingresso || p.tipo || "sem categoria"))}</span></div>
          ${dentro ? `<span class="ck-insc-ok">✓ No local</span>` : saiu ? `<span class="ck-insc-saiu">Saiu às ${esc(horaCurta(saiu.at))}</span>` : ""}
          ${pode ? (inscritoRemovendo === p.id
            ? `<button class="ck-mini perigo" data-remover-ok>Remover</button><button class="ck-mini" data-remover-nao>Não</button>`
            : `<button class="ck-mini" data-remover>Remover</button>`) : ""}</div>`;
      }).join("")
    : `<p class="ck-busca-vazio">Ninguém inscrito ainda.${podeAdd ? " Use os botões acima ou a pesquisa." : " Para adicionar pessoas, libere em Configurações ▸ Adicionar participantes."}</p>`;
  el("atv-insc-lista").querySelectorAll("[data-pid]").forEach((row) => {
    const pid = row.dataset.pid;
    const on = (sel, fn) => { const b = row.querySelector(sel); if (b) b.onclick = fn; };
    on("[data-remover]", () => { inscritoRemovendo = pid; renderAtividades(); });
    on("[data-remover-nao]", () => { inscritoRemovendo = null; renderAtividades(); });
    on("[data-remover-ok]", async () => {
      try {
        // igual à plataforma: sai da lista de inscritos e o histórico de entrada/saída dele nesta atividade é apagado
        const alvoNome = participantes.find((x) => x.id === pid)?.nome;
        await comOffline(novaOp("remover_inscrito", { atv: atv.id, pid, nome: alvoNome }));
        inscritos = inscritos.filter((x) => !(x.atividade_id === atv.id && x.participante_id === pid));
        checkins = checkins.filter((c) => !(c.atividade_id === atv.id && c.participante_id === pid));
        toast("Removido da atividade.", "ok");
      } catch (e) { toast(e.message || "Não foi possível remover.", "erro"); }
      inscritoRemovendo = null;
      renderAtividades();
    });
  });
}
// inscreve alguém na atividade (devolve false se já estava)
async function inscrever(p, atv) {
  if (!p || !atv) return false;
  if (estaInscrito(p.id, atv.id)) return false;
  if (!podeInscrever()) { toast("Libere em Configurações ▸ Adicionar participantes para inscrever pessoas.", "erro"); return false; }
  try {
    const op = novaOp("inscrever", { atv: atv.id, pid: p.id, operador: operador(), nome: p.nome });
    await comOffline(op);
    inscritos.push({ id: op.uid, atividade_id: atv.id, participante_id: p.id });
    toast(`${p.nome} inscrito(a) em ${atv.nome}.`, "ok");
    return true;
  } catch (e) {
    toast(/duplicate|unique|23505/i.test(e.message || "") ? "Já estava inscrito(a)." : (e.message || "Não foi possível inscrever."), "erro");
    return false;
  }
}

// ação direta de entrada/saída/inscrição lendo o QR (ou escolhendo pelo nome)
async function iniciarScanAtividade(acao) {
  const atv = atvSelecionada();
  if (!atv) { toast("Escolha uma atividade.", "erro"); return; }
  limparModo();
  modo = atv.id;
  atvAcao = acao;
  const rotulo = { entrada: "Entrada", saida: "Saída", inscrever: "Adicionar", inscrever_entrada: "Adicionar + check-in" }[acao];
  el("topo-evento").textContent = evento?.nome || "Evento";
  el("topo-ctx").textContent = `▤ ${atv.nome} · ${rotulo}`;
  await mostrarTela("app");
}

async function registrarAcessoAtv(p, atv, acao) {
  const op = novaOp("checkin", { pid: p.id, acao, origem: ORIGEM_APP, atv: atv.id, nome: p.nome });
  await comOffline(op);
  checkins.unshift({ id: op.uid, participante_id: p.id, acao, at: op.at, atividade_id: atv.id, origem: ORIGEM_APP,
    participante: { nome: p.nome, ingresso: p.ingresso, codigo: p.codigo } });
}

// Observações mostradas junto com a confirmação da entrada na atividade
async function notasDaEntrada(p, atv) {
  const cat = (p.ingresso || p.tipo || "").trim();
  const notas = [];
  const inscrito = await garantirInscricao(p, atv);
  notas.push(inscrito ? { texto: "Inscrito na atividade", nivel: "ok" } : { texto: "NÃO inscrito na atividade", nivel: "alerta" });
  if (atv.categorias?.length && !atv.categorias.includes(cat)) notas.push({ texto: "Categoria NÃO liberada nesta atividade", nivel: "alerta" });
  if (atv.vagas && credenciadosNaAtv(atv.id).length >= atv.vagas) notas.push({ texto: "Atividade lotada", nivel: "alerta" });
  return notas;
}

async function processarNaAtividade(p) {
  const atv = atvAtual();
  const acao = atvAcao;
  if (!atv || !acao) return abrirSheet(p);
  const dentro = !!saldoAtividade(p.id, atv.id);
  // amarelo = já está / não consta (atenção, nada gravado); vermelho = acesso bloqueado
  const avisar = (texto, tom = "atencao") => { navigator.vibrate?.([80, 60, 80]); telaSucesso(p, null, { texto, tom }); setTimeout(retomar, 1500); };
  if (p.acesso_bloqueado) return avisar("Acesso bloqueado", "erro");
  try {
    if (acao === "inscrever") {
      if (estaInscrito(p.id, atv.id)) return avisar(`Já está inscrito(a) em ${atv.nome}`);
      if (!(await inscrever(p, atv))) return setTimeout(retomar, 800);
      telaSucesso(p, null, { texto: `Inscrito(a) em ${atv.nome}` });
      return setTimeout(retomar, 1100);
    }
    if (acao === "saida") {
      if (!dentro) {   // VERMELHO: não está na atividade, não tem o que sair
        navigator.vibrate?.([80, 60, 80]);
        telaSucesso(p, null, { tom: "erro", texto: "ACESSO NÃO LIBERADO", notas: [{ texto: `Não consta na atividade ${atv.nome}`, nivel: "alerta" }], duracao: 2200 });
        return setTimeout(retomar, 1900);
      }
      await registrarAcessoAtv(p, atv, "saida");
      telaSucesso(p, null, { texto: `Saída de ${atv.nome}` });
      return setTimeout(retomar, 1100);
    }
    if (dentro) return avisar(`Já está na atividade ${atv.nome}`);   // AMARELO
    if (acao === "inscrever_entrada") {
      if (!estaInscrito(p.id, atv.id) && !(await inscrever(p, atv))) return setTimeout(retomar, 800);   // "Adicionar + check-in" inscreve e dá a entrada
    } else if (!(await garantirInscricao(p, atv))) {
      return avisar(`NÃO INSCRITO na atividade ${atv.nome} — acesso não liberado`, "erro");   // VERMELHO: não entra, nada é gravado
    }
    // INSCRITO → tela VERDE de confirmação: nome, categoria e as observações (inscrito, categoria não liberada, lotada)
    const notas = await notasDaEntrada(p, atv);
    await registrarAcessoAtv(p, atv, "entrada");
    telaSucesso(p, null, { texto: `Entrada em ${atv.nome}`, notas, duracao: 2200 });
    setTimeout(retomar, 1900);
  } catch (e) {
    toast(e.message || "Falha ao registrar.", "erro");
    setTimeout(retomar, 800);
  }
}

/* ---- adicionar participantes (trava com a senha do evento) -------------- */
// "Liberado" vale para ESTE aparelho e ESTE evento, enquanto a senha não mudar (guardamos o hash que foi aceito).
const chaveAddPart = () => `ck_add_part_${evento?.id || ""}`;
const addPartLiberado = () => !!evento?.senha_adicionar_hash && lembrado(chaveAddPart()) === evento.senha_adicionar_hash;

function renderAddPart() {
  el("part-add").hidden = !addPartLiberado();
  el("cfg-addpart-estado").textContent = addPartLiberado() ? "Liberado" : "Bloqueado";
}

function aoTocarAddPart() {
  if (addPartLiberado()) {   // liberado → toque de novo trava
    guardar(chaveAddPart(), "");
    toast("Adicionar participantes travado neste aparelho.", "ok");
    renderAddPart();
    return;
  }
  abrirDesbloqueio();
}

function abrirDesbloqueio() {
  const sheet = el("sheet");
  sheet.classList.remove("ficha");
  if (!evento?.senha_adicionar_hash) {
    sheet.innerHTML = `<div class="ck-sheet-puxador"></div>
      <h3>Adicionar participantes</h3>
      <p class="ck-sheet-txt">Este evento ainda não tem senha. Peça a um administrador para definir em <b>Configurações ▸ Check-in</b> na plataforma.</p>
      <div class="ck-sheet-acoes"><button class="ck-btn ck-btn-fantasma" data-acao="fechar">Fechar</button></div>`;
    mostrarSheet();
    sheet.querySelector("[data-acao]").onclick = () => fecharSheet();
    return;
  }
  sheet.innerHTML = `<div class="ck-sheet-puxador"></div>
    <h3>Liberar adicionar participantes</h3>
    <p class="ck-sheet-txt">Digite a senha do evento para poder adicionar participantes e inscrever pessoas em atividades neste aparelho.</p>
    <input class="ck-input" id="sn-senha" type="password" autocomplete="off" placeholder="Senha" />
    <p class="ck-form-erro" id="sn-erro" hidden style="margin-top:8px">Senha incorreta.</p>
    <div class="ck-sheet-acoes" style="margin-top:14px">
      <button class="ck-btn ck-btn-primario" id="sn-ok" type="button">Liberar</button>
      <button class="ck-btn ck-btn-fantasma" id="sn-cancelar" type="button">Cancelar</button>
    </div>`;
  mostrarSheet();
  const tentar = async () => {
    const digitada = el("sn-senha").value;
    let ok = false;
    try { ok = (await hashSenhaEvento(evento.id, digitada)) === evento.senha_adicionar_hash; } catch { ok = false; }
    if (!ok) { el("sn-erro").hidden = false; navigator.vibrate?.([80, 60, 80]); el("sn-senha").select(); return; }
    guardar(chaveAddPart(), evento.senha_adicionar_hash);
    fecharSheet();
    toast("Adicionar participantes liberado neste aparelho.", "ok");
    renderAddPart();
  };
  el("sn-ok").onclick = tentar;
  el("sn-cancelar").onclick = () => fecharSheet();
  el("sn-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") tentar(); });
  setTimeout(() => el("sn-senha")?.focus(), 300);
}

function abrirNovoParticipante() {
  if (!addPartLiberado()) { abrirDesbloqueio(); return; }
  ["np-nome", "np-email", "np-tel", "np-empresa"].forEach((id) => { el(id).value = ""; });
  el("np-tipo").value = "Convidado";
  el("np-ingresso").innerHTML = `<option value="">— sem categoria —</option>` +
    tiposIngresso.map((t) => `<option>${esc(t.nome)}</option>`).join("");
  el("np-erro").hidden = true;
  el("tela-novo").hidden = false;
  garantirHistorico();
  setTimeout(() => el("np-nome").focus(), 200);
}
function fecharNovoParticipante() { el("tela-novo").hidden = true; }

const normalizaNome = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function salvarNovoParticipante(credenciar) {
  const erro = (m) => { el("np-erro").textContent = m; el("np-erro").hidden = false; };
  el("np-erro").hidden = true;
  const nome = el("np-nome").value.trim();
  const email = el("np-email").value.trim();
  if (!nome) return erro("Informe o nome.");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro("E-mail inválido.");
  // mesmo e-mail e mesmo nome = já cadastrado (e-mail igual com nome diferente é outra pessoa, como nas vendas)
  if (email && participantes.some((p) => (p.email || "").toLowerCase() === email.toLowerCase() && normalizaNome(p.nome) === normalizaNome(nome))) {
    return erro("Já existe um participante com esse nome e e-mail.");
  }
  const botoes = ["np-salvar", "np-salvar-cred"].map(el);
  botoes.forEach((b) => { b.disabled = true; });
  try {
    const dados = {
      nome, email: email || null, telefone: el("np-tel").value.trim() || null,
      empresa: el("np-empresa").value.trim() || null,
      tipo: el("np-tipo").value, ingresso: el("np-ingresso").value || null,
    };
    // o id nasce no celular: dá pra credenciar e imprimir a etiqueta já (o QR usa o id; o código chega ao sincronizar)
    const op = novaOp("novo_participante", { pid: novoId(), dados, nome });
    const r = await comOffline(op);
    const novo = r.resultado ? { ...r.resultado } : { id: op.pid, ...dados, situacao: "Confirmado", pagamento: "Gratuito", quantidade: 1, codigo: null, presente: false, created_at: op.at };
    participantes.push(novo);
    fecharNovoParticipante();
    renderParticipantes();
    toast(`${novo.nome} cadastrado(a).`, "ok");
    if (credenciar) abrirFicha(novo);
  } catch (e) {
    erro(e.message || "Não foi possível cadastrar.");
  } finally {
    botoes.forEach((b) => { b.disabled = false; });
  }
}

/* ---- aba 4: configurações ------------------------------------------- */
function renderConfig() {
  el("cfg-usuario").textContent = sessao?.user?.email || "";
  el("cfg-evento").textContent = evento?.nome || "";
  el("cfg-operador").value = lembrado("ck_operador") || (sessao?.user?.email || "").split("@")[0];
  el("cfg-tema-txt").textContent = document.documentElement.dataset.theme === "light" ? "Tema escuro" : "Tema claro";
  el("cfg-atv-add").checked = podeAdicionarAtv();
  renderAddPart();
}

/* ---- pontos de controle (cadastro) ----------------------------------- */
let pontoEditando = null, pontoExcluindo = null;
function abrirPontos() {
  pontoEditando = null; pontoExcluindo = null;
  el("tela-pontos").hidden = false;
  renderPontos();
  garantirHistorico();
}
function fecharPontos() {
  el("tela-pontos").hidden = true;
  renderAcesso();
  renderConfig();
}
function renderPontos() {
  if (pontosIndisponivel) {
    el("pontos-lista").innerHTML = `<p class="pagina-sub-ck">Rode a migração <code>0047_pontos_de_controle.sql</code> no SQL Editor para ativar os pontos de controle.</p>`;
    return;
  }
  el("pontos-lista").innerHTML = pontos.length
    ? pontos.map((p) => {
        if (pontoEditando === p.id) {
          return `<div class="ck-ponto" data-id="${p.id}"><input class="ck-input" data-nome value="${esc(p.nome)}" />
            <button class="ck-mini" data-salvar>Salvar</button><button class="ck-mini" data-cancelar>Cancelar</button></div>`;
        }
        if (pontoExcluindo === p.id) {
          return `<div class="ck-ponto" data-id="${p.id}"><strong>Excluir “${esc(p.nome)}”? Os registros de acesso dele também somem.</strong>
            <button class="ck-mini perigo" data-confirmar>Excluir</button><button class="ck-mini" data-cancelar>Não</button></div>`;
        }
        return `<div class="ck-ponto" data-id="${p.id}"><strong class="${p.ativo ? "" : "inativo"}">${esc(p.nome)}</strong>
          <button class="ck-mini" data-editar>Renomear</button>
          <button class="ck-mini" data-ativo>${p.ativo ? "Desativar" : "Ativar"}</button>
          <button class="ck-mini perigo" data-excluir>Excluir</button></div>`;
      }).join("")
    : `<p class="ck-busca-vazio">Nenhum ponto ainda. Adicione o primeiro acima.</p>`;
  el("pontos-lista").querySelectorAll("[data-id]").forEach((row) => {
    const id = row.dataset.id;
    const on = (sel, fn) => { const b = row.querySelector(sel); if (b) b.onclick = fn; };
    on("[data-editar]", () => { pontoEditando = id; pontoExcluindo = null; renderPontos(); });
    on("[data-excluir]", () => { pontoExcluindo = id; pontoEditando = null; renderPontos(); });
    on("[data-cancelar]", () => { pontoEditando = null; pontoExcluindo = null; renderPontos(); });
    on("[data-salvar]", async () => {
      const nome = row.querySelector("[data-nome]").value.trim();
      if (!nome) return toast("Dê um nome ao ponto.", "erro");
      await alterarPonto(id, { nome });
      pontoEditando = null; renderPontos();
    });
    on("[data-ativo]", async () => { const p = pontos.find((x) => x.id === id); await alterarPonto(id, { ativo: !p.ativo }); renderPontos(); });
    on("[data-confirmar]", async () => {
      if (exigeInternet()) return;
      try {
        await remover("pontos_controle", id);
        pontos = pontos.filter((p) => p.id !== id);
        acessos = acessos.filter((a) => a.ponto_id !== id);
        if (lembrado("ck_ponto") === id) guardar("ck_ponto", "");
        pontoExcluindo = null; renderPontos();
        toast("Ponto excluído.", "ok");
      } catch (e) { toast(e.message || "Não foi possível excluir.", "erro"); }
    });
  });
}
async function alterarPonto(id, patch) {
  if (exigeInternet()) return;
  try {
    const novo = await salvar("pontos_controle", { id, ...patch });
    Object.assign(pontos.find((p) => p.id === id) || {}, novo);
  } catch (e) { toast(e.message || "Não foi possível salvar.", "erro"); }
}
const exigeInternet = () => { if (estaOffline()) { toast("Sem internet: pontos de controle só podem ser alterados online.", "erro"); return true; } return false; };
async function adicionarPonto() {
  if (exigeInternet()) return;
  const nome = el("ponto-novo").value.trim();
  if (!nome) return toast("Dê um nome ao ponto.", "erro");
  if (pontos.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) return toast("Já existe um ponto com esse nome.", "erro");
  try {
    const ordem = pontos.reduce((m, p) => Math.max(m, p.ordem || 0), 0) + 1;
    const novo = await salvar("pontos_controle", { nome, ordem, ativo: true });
    pontos.push(novo);
    el("ponto-novo").value = "";
    renderPontos();
  } catch (e) {
    toast(/pontos_controle|does not exist|schema cache/i.test(e.message || "") ? "Rode a migração 0047 no SQL Editor." : (e.message || "Não foi possível salvar."), "erro");
  }
}

/* ---- registro de acesso (menu) --------------------------------------- */
let registroPonto = "";   // "" = todos os pontos
function abrirRegistro() {
  registroPonto = "";
  el("tela-registro").hidden = false;
  renderRegistro();
  garantirHistorico();
}
function fecharRegistro() { el("tela-registro").hidden = true; }
function renderRegistro() {
  const comRegistro = new Set(acessos.map((a) => a.ponto_id));
  const lista = pontos.filter((p) => p.ativo || comRegistro.has(p.id));
  el("registro-chips").innerHTML =
    [`<button class="ck-chip ${registroPonto === "" ? "ativo" : ""}" data-p="">Todos</button>`]
      .concat(lista.map((p) => `<button class="ck-chip ${registroPonto === p.id ? "ativo" : ""}" data-p="${p.id}">${esc(p.nome)}</button>`)).join("");
  el("registro-chips").querySelectorAll("[data-p]").forEach((b) => { b.onclick = () => { registroPonto = b.dataset.p; renderRegistro(); }; });

  const min = Number(el("rf-tempo").value) || 0;
  const desde = min ? Date.now() - min * 60000 : 0;
  const acaoF = el("rf-acao").value;
  const op = el("rf-operador").value.trim().toLowerCase();
  const nomePonto = (id) => pontos.find((p) => p.id === id)?.nome || "—";
  const filtrado = acessos.filter((a) =>
    (!registroPonto || a.ponto_id === registroPonto)
    && (!desde || new Date(a.at).getTime() >= desde)
    && (!acaoF || a.acao === acaoF)
    && (!op || (a.operador || "").toLowerCase().includes(op)));
  el("registro-lista").innerHTML = filtrado.length
    ? filtrado.slice(0, 300).map((a) => `<div class="ck-reg-item"><span class="ck-avatar sm">${AVATAR}</span>
        <div><strong>${esc(a.participante?.nome || "—")}</strong>
          <span>${esc(nomePonto(a.ponto_id))} · ${esc(fmtDataHora(a.at))}</span>
          ${a.operador ? `<span>operador: ${esc(a.operador)}</span>` : ""}</div>
        <span class="ck-reg-acao ${a.acao}">${a.acao === "entrada" ? "Entrada" : "Saída"}</span></div>`).join("")
    : `<p class="ck-busca-vazio">${pontosIndisponivel ? "Rode a migração 0047 para ativar o controle de acesso." : "Nenhum registro com esses filtros."}</p>`;
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
const FMT_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const horaCurta = (iso) => { try { return FMT_HORA.format(new Date(iso)); } catch { return ""; } };
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
// A câmera fica SEMPRE ligada: pausar/retomar o vídeo travava a próxima leitura no WebView do Android.
// Enquanto há resultado/folha na tela, as leituras são só ignoradas (travado).
let ultimaLeitura = { texto: "", ate: 0 };
let travadoVigia = 0;
async function pausar() { /* câmera segue ligada */ }
async function retomar() {
  ultimaLeitura.ate = Date.now() + 2500;   // o mesmo QR ainda na frente da câmera não vale como leitura nova
  travado = false;
  if (!camAtiva && el("app").hidden === false) abrirCamera();
}
// se por qualquer motivo a leitura ficar travada sem nada na tela, destrava sozinha (~6 s)
setInterval(() => {
  const algoNaTela = !el("sheet").hidden || !el("tela-busca").hidden || !!document.querySelector(".ck-sucesso");
  if (travado && el("app").hidden === false && !algoNaTela) { if (++travadoVigia >= 3) { travadoVigia = 0; retomar(); } }
  else travadoVigia = 0;
}, 2000);

async function onScan(texto) {
  if (travado) return;
  if (texto === ultimaLeitura.texto && Date.now() < ultimaLeitura.ate) return;
  travado = true;
  ultimaLeitura = { texto, ate: Infinity };
  try {
    await tratarLeitura(texto);
  } catch (e) {
    console.warn(e);
    toast("Não consegui processar a leitura. Tente de novo.", "erro");
    retomar();
  }
}
async function tratarLeitura(texto) {
  navigator.vibrate?.(60);
  await pausar();
  el("mira-txt").textContent = "Buscando…";
  let p = participantes.find((x) => (x.codigo && texto.includes(x.codigo)) || (x.id && texto.includes(x.id)));
  const comRede = !estaOffline() && OFF.pendentes === 0;   // com fila pendente a cópia local manda (o banco ainda não sabe)
  if (pontoModo) {
    // controle de acesso: confere o cadastro mais novo no banco (credenciamento e bloqueio feitos em outro aparelho)
    if (comRede) { try { const fresco = await comTimeout(buscarParticipantePorQR(texto), 2500); if (fresco) p = fresco; } catch {} }
  } else if (!p && comRede) { try { p = await comTimeout(buscarParticipantePorQR(texto), 4000); } catch {} }
  el("mira-txt").textContent = "Aponte para o QR Code do crachá";
  if (!p && pontoModo) return resultadoPonto({ nome: "Crachá não reconhecido" }, "erro", "Não está na lista de participantes");
  if (!p) return abrirSheetErro(texto);
  if (pontoModo) return registrarNoPonto(p);
  if (atvAcao) return processarNaAtividade(p);
  abrirSheet(p);
}

/* ---- bottom sheet -------------------------------------------------- */
/* ---- ficha do participante (lista e leitura de QR no evento): abas Ações e Label ---- */
function abrirFicha(p, abaFicha = "acoes") {
  const cat = (p.ingresso || p.tipo || "").trim();
  const confirmado = (p.situacao || "Confirmado") === "Confirmado";
  const entrada = entradaEvento(p);
  const bloqueado = !!p.acesso_bloqueado;
  const sheet = el("sheet");
  sheet.classList.add("ficha");
  sheet.innerHTML = `
    <div class="ck-sheet-puxador"></div>
    <div class="ck-ficha-cab">
      <div class="ck-avatar">${AVATAR}</div>
      <strong>${esc(p.nome || "—")}</strong>
      ${p.email ? `<span class="ck-ficha-email">${esc(p.email)}</span>` : ""}
      ${cat ? `<span class="ck-pessoa-cat">${esc(cat)}</span>` : ""}
      <span class="ck-ficha-sit ${confirmado ? "ok" : "alerta"}">${confirmado ? "Inscrição confirmada" : esc(p.situacao || "—")}</span>
      ${bloqueado ? `<span class="ck-ficha-sit bloq">Acesso bloqueado</span>` : ""}
      <span class="ck-ficha-status ${entrada ? "ok" : ""}">${entrada ? `Credenciado às ${esc(horaCurta(entrada.at))}` : "Ainda não foi credenciado"}</span>
    </div>
    <div class="ck-ficha-abas">
      <button type="button" data-aba="acoes" class="${abaFicha === "acoes" ? "ativa" : ""}">Ações</button>
      <button type="button" data-aba="label" class="${abaFicha === "label" ? "ativa" : ""}">Label</button>
    </div>
    <div id="ficha-corpo"></div>`;

  const corpo = sheet.querySelector("#ficha-corpo");
  if (abaFicha === "label") {
    corpo.innerHTML = `
      <div class="ck-label-prev" id="label-prev"><p class="ck-busca-vazio" style="padding:20px">Montando a etiqueta…</p></div>
      <button class="ck-btn ck-btn-primario" data-acao="reimprimir" ${bloqueado ? "disabled" : ""}>Imprimir etiqueta</button>`;
    desenharPreviaEtiqueta(p, corpo.querySelector("#label-prev"));
  } else {
    const travaCheckin = bloqueado || !!entrada;
    corpo.innerHTML = `
      <div class="ck-sheet-acoes">
        <button class="ck-btn ck-btn-primario" data-acao="credenciar" ${travaCheckin ? "disabled" : ""}>Credenciar + imprimir etiqueta</button>
        <div class="ck-duplo-btn">
          <button class="ck-btn ck-btn-secundario" data-acao="credenciar-so" ${travaCheckin ? "disabled" : ""}>Credenciar</button>
          <button class="ck-btn ck-btn-secundario" data-acao="so-checkin" ${travaCheckin ? "disabled" : ""}>Check-in</button>
        </div>
        <button class="ck-btn ck-btn-secundario" data-acao="reimprimir" ${bloqueado ? "disabled" : ""}>Imprimir etiqueta</button>
        ${bloqueado
          ? `<button class="ck-btn ck-btn-secundario" data-acao="liberar">Liberar acesso</button>`
          : `<button class="ck-btn ck-btn-bloquear" data-acao="bloquear">Bloquear acesso</button>`}
      </div>
      ${bloqueado ? `<p class="ck-ficha-nota">Acesso bloqueado: esta pessoa não faz check-in nem passa nos pontos de controle e atividades até você liberar.</p>` : ""}`;
  }
  mostrarSheet();
  sheet.querySelectorAll("[data-aba]").forEach((b) => { b.onclick = () => abrirFicha(p, b.dataset.aba); });
  sheet.querySelectorAll("[data-acao]").forEach((b) => { b.onclick = () => acao(b.dataset.acao, p, b); });
}

// prévia da etiqueta no mesmo layout que sai impresso (largura × altura configuradas), reduzida pra caber na tela
async function desenharPreviaEtiqueta(p, caixa) {
  try {
    const base = evento?.cracha_config || CRACHA_PADRAO;
    // a etiqueta sai DEITADA (horizontal): o lado maior fica na horizontal, qualquer que seja a ordem largura × altura salva
    const l = Number(base.largura_mm) || 90, a = Number(base.altura_mm) || 55;
    const config = { ...base, largura_mm: Math.max(l, a), altura_mm: Math.min(l, a) };
    const qr = config.qr !== false ? await qrDataURL(p.codigo || p.id || "") : null;
    caixa.innerHTML = montarCrachaHtml(p, evento?.nome || "", config, qr);
    const cartao = caixa.firstElementChild;
    const disponivel = caixa.clientWidth - 24;
    const s = Math.min(1, disponivel / cartao.offsetWidth);
    cartao.style.transformOrigin = "top left";
    cartao.style.transform = `scale(${s})`;
    caixa.style.height = `${cartao.offsetHeight * s + 24}px`;
    cartao.style.margin = "12px 0 0 12px";
  } catch {
    caixa.innerHTML = `<p class="ck-busca-vazio">Não foi possível montar a prévia.</p>`;
  }
}

// marca/desmarca o bloqueio de acesso (0049) e redesenha a ficha
async function definirBloqueio(p, bloquear) {
  try {
    await comOffline(novaOp("bloqueio", { pid: p.id, bloquear, nome: p.nome }));
    p.acesso_bloqueado = bloquear;
    toast(bloquear ? `${p.nome}: acesso bloqueado.` : `${p.nome}: acesso liberado.`, "ok");
    if (!el("tela-shell").hidden) renderParticipantes();
    abrirFicha(p, "acoes");
  } catch (e) {
    toast(/acesso_bloqueado|schema cache|column/i.test(e.message || "") ? "Rode a migração 0049 no SQL Editor." : (e.message || "Não foi possível salvar."), "erro");
  }
}

// Está inscrito na atividade? Confere a lista local e, se não achar, o banco (outro aparelho pode ter inscrito agora).
// Sem a migração 0048 a regra de inscrição não vale (devolve true pra não travar todo mundo).
async function garantirInscricao(p, atv) {
  if (inscritosIndisponivel) return true;
  if (estaInscrito(p.id, atv.id)) return true;
  if (estaOffline() || OFF.pendentes > 0) return false;   // sem rede vale a lista salva no aparelho
  try {
    const r = await comTimeout(inscricaoDaAtividade(atv.id, p.id), 2500);
    if (r) { inscritos.push(r); return true; }
  } catch { /* sem rede: vale o que já está na lista local */ }
  return false;
}

// folha de decisão da ATIVIDADE (o evento geral usa abrirFicha). Mostra em destaque se a pessoa está INSCRITA;
// quem não está inscrito NÃO tem a opção de credenciar.
async function abrirSheet(p) {
  const atv = atvAtual();
  if (!atv) return abrirFicha(p);   // evento geral: ficha com as abas Ações / Label
  el("sheet").classList.remove("ficha");
  const cat = (p.ingresso || p.tipo || "").trim();
  const confirmado = (p.situacao || "Confirmado") === "Confirmado";
  const entrada = saldoAtividade(p.id, atv.id);
  const inscrito = await garantirInscricao(p, atv);
  const bloqueado = !!p.acesso_bloqueado;

  const alertas = [];
  if (bloqueado) alertas.push("✕ Acesso bloqueado");
  if (atv.categorias?.length && !atv.categorias.includes(cat)) alertas.push("⚠ Categoria não liberada nesta atividade");
  if (atv.vagas && credenciadosNaAtv(atv.id).length >= atv.vagas && !entrada) alertas.push("⚠ Atividade lotada");

  const podeCredenciar = inscrito && !bloqueado;
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
    <div class="ck-inscricao ${inscrito ? "sim" : "nao"}">
      ${inscrito ? "✓ INSCRITO na atividade" : "✕ NÃO INSCRITO na atividade"}
      <small>${esc(atv.nome)}</small>
    </div>
    <div class="ck-status">
      <span class="ck-status-linha ${confirmado ? "ok" : "alerta"}">
        ${confirmado ? "✓ Inscrição no evento confirmada" : "• Situação: " + esc(p.situacao || "—")}
      </span>
      <span class="ck-status-linha ${entrada ? "ok" : "neutro"}">
        ${entrada ? `✓ Na atividade desde ${esc(horaCurta(entrada.at))}` : "Ainda não entrou nesta atividade"}
      </span>
      ${alertas.map((a) => `<span class="ck-status-linha alerta">${a}</span>`).join("")}
    </div>
    <div class="ck-sheet-acoes">
      ${entrada ? `
        <button class="ck-btn ck-btn-secundario" data-acao="saida-atv">Registrar saída da atividade</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Escanear outro</button>
      ` : podeCredenciar ? `
        <button class="ck-btn ck-btn-primario" data-acao="atv">Credenciar na atividade</button>
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Cancelar</button>
      ` : `
        ${!inscrito && !bloqueado && podeInscrever() ? `<button class="ck-btn ck-btn-secundario" data-acao="inscrever-atv">Inscrever nesta atividade</button>` : ""}
        <button class="ck-btn ck-btn-fantasma" data-acao="fechar">Fechar</button>
      `}
    </div>`;
  mostrarSheet();
  el("sheet").querySelectorAll("[data-acao]").forEach((b) => { b.onclick = () => acao(b.dataset.acao, p, b); });
}

function abrirSheetErro(texto) {
  el("sheet").classList.remove("ficha");
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
  garantirHistorico();
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
  if (tipo === "bloquear" || tipo === "liberar") { btn.disabled = true; return definirBloqueio(p, tipo === "bloquear"); }
  if (p.acesso_bloqueado) { toast("Acesso bloqueado. Libere o acesso para continuar.", "erro"); return; }
  if (tipo === "inscrever-atv") {
    btn.disabled = true;
    if (await inscrever(p, atv)) { renderAtividades(); abrirSheet(p); } else btn.disabled = false;
    return;
  }
  if (tipo === "atv" && !(await garantirInscricao(p, atv))) { toast("Só quem está inscrito na atividade pode ser credenciado.", "erro"); return; }

  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Registrando…";
  try {
    if (tipo === "saida-atv") {
      const opS = novaOp("checkin", { pid: p.id, acao: "saida", origem: ORIGEM_APP, atv: atv.id, nome: p.nome });
      await comOffline(opS);
      checkins.unshift({ id: opS.uid, participante_id: p.id, acao: "saida", at: opS.at, atividade_id: atv.id, origem: ORIGEM_APP });
      fecharSheet();
      toast(`Saída de ${p.nome} registrada.`, "ok");
      return;
    }
    const atvId = tipo === "atv" ? atv.id : null;
    const opE = novaOp("checkin", { pid: p.id, acao: "entrada", origem: ORIGEM_APP, atv: atvId, nome: p.nome });
    await comOffline(opE);
    checkins.unshift({ id: opE.uid, participante_id: p.id, acao: "entrada", at: opE.at, atividade_id: atvId, origem: ORIGEM_APP });
    if (!atvId) p.presente = true;
    if (tipo === "credenciar") imprimirCracha(p, evento.nome || "");
    fecharSheet();
    telaSucesso(p, atvId ? atv.nome : null);
    if (!el("tela-shell").hidden) renderParticipantes();
  } catch (e) {
    btn.disabled = false; btn.textContent = antes;
    toast(e.message || "Falha ao registrar.", "erro");
  }
}

// resultado em tela cheia: tom "ok" (verde), "erro" (vermelho) ou "atencao" (amarelo); mostra nome e categoria
function telaSucesso(p, atvNome, opts = {}) {
  const tom = opts.tom || (opts.aviso ? "erro" : "ok");
  const d = document.createElement("div");
  d.className = "ck-sucesso" + (tom === "erro" ? " aviso" : tom === "atencao" ? " atencao" : "");
  const texto = opts.texto || (atvNome ? "credenciado(a) em " + atvNome : "credenciado(a)");
  const cat = (p.ingresso || p.tipo || "").trim();
  const icone = tom === "ok" ? "✓" : tom === "erro" ? "✕" : "!";
  const notas = (opts.notas || []).map((n) => `<b class="ck-nota ${n.nivel === "ok" ? "ok" : "alerta"}">${n.nivel === "ok" ? "✓" : "⚠"} ${esc(n.texto)}</b>`).join("");
  d.innerHTML = `<div class="ck-sucesso-check">${icone}</div><strong>${esc(p.nome)}</strong>${cat ? `<em class="ck-sucesso-cat">${esc(cat)}</em>` : ""}<span>${esc(texto)}</span>${notas ? `<div class="ck-notas">${notas}</div>` : ""}`;
  document.body.appendChild(d);
  void d.offsetHeight;
  setTimeout(() => d.classList.add("aberto"), 10);
  const sair = () => { d.classList.remove("aberto"); setTimeout(() => d.remove(), 250); };
  d.onclick = sair;
  setTimeout(sair, opts.duracao || 1600);
}

/* ---- lista de participantes / busca manual ------------------------ */
function abrirBusca() {
  pausar();
  el("tela-busca").hidden = false;
  el("in-busca").value = "";
  renderBusca();
  garantirHistorico();
}
function fecharBusca() {
  el("tela-busca").hidden = true;
  if (el("app").hidden === false) retomar();
}
// botão flutuante "Ler QRCode": se já estava no scanner, só retoma a câmera;
// se veio do menu/lista direto, inicia o scanner de verdade.
function irParaScanner() {
  const jaNoScanner = el("app").hidden === false;
  el("tela-busca").hidden = true;
  if (jaNoScanner) retomar();
  else iniciarScanEvento();
}
function renderBusca() {
  const t = el("in-busca").value.trim().toLowerCase();
  const atv = atvAtual();
  const base = t
    ? participantes.filter((p) => `${p.nome} ${p.email || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase().includes(t))
    : [...participantes].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const achados = base.slice(0, t ? 30 : 300);
  el("busca-lista").innerHTML = achados.length
    ? achados.map((p) => htmlItemParticipante(p, atv)).join("")
    : `<p class="ck-busca-vazio">${t ? "Ninguém encontrado." : "Nenhum participante neste evento."}</p>`;
  el("busca-lista").querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => {
      el("tela-busca").hidden = true;
      const escolhido = participantes.find((x) => x.id === b.dataset.id);
      if (pontoModo) registrarNoPonto(escolhido);
      else if (atvAcao) processarNaAtividade(escolhido);
      else abrirSheet(escolhido);
    };
  });
}

/* ---- tema claro/escuro ------------------------------------------------ */
const TEMA_KEY = "ck_tema";
function temaSalvo() {
  try { return localStorage.getItem(TEMA_KEY); } catch { return null; }
}
function aplicarTema(t) {
  const claro = t === "light";
  document.documentElement.dataset.theme = claro ? "light" : "dark";
  try { localStorage.setItem(TEMA_KEY, claro ? "light" : "dark"); } catch {}
  const rot = claro ? "Tema escuro" : "Tema claro";
  const ic = claro ? ICONE_LUA : ICONE_SOL;
  if (el("btn-tema")) { el("btn-tema").innerHTML = ic; el("btn-tema").setAttribute("aria-label", rot); }
  if (el("menu-tema-ic")) el("menu-tema-ic").innerHTML = ic;
  if (el("menu-tema-txt")) el("menu-tema-txt").textContent = rot;
}
function alternarTema() {
  aplicarTema(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

/* ---- menu lateral --------------------------------------------------- */
function abrirMenu() {
  el("menu-usuario").textContent = sessao?.user?.email || "";
  el("menu-fundo").hidden = false;
  el("menu").hidden = false;
  void el("menu").offsetHeight;
  setTimeout(() => { el("menu-fundo").classList.add("aberto"); el("menu").classList.add("aberto"); }, 10);
  garantirHistorico();
}
function fecharMenu() {
  el("menu-fundo").classList.remove("aberto");
  el("menu").classList.remove("aberto");
  setTimeout(() => { el("menu-fundo").hidden = true; el("menu").hidden = true; }, 240);
}

/* ---- impressora / etiqueta ------------------------------------------ */
const CFG_ROTULOS = {
  evento: "Evento", nome: "Nome", categoria: "Categoria", texto: "Texto fixo",
  empresa: "Empresa", email: "E-mail", telefone: "Telefone", codigo: "Código",
};
const CFG_FIXOS = ["evento", "nome", "categoria"];

async function abrirConfig() {
  pausar();
  el("tela-config").hidden = false;
  garantirHistorico();
  try {
    const ev = await getEvento(evento.id);
    montarConfigForm(ev?.cracha_config);
  } catch (e) { toast(e.message || "Falha ao carregar configuração.", "erro"); }
}
function fecharConfig() {
  el("tela-config").hidden = true;
  if (el("app").hidden === false) retomar();
}

function montarConfigForm(salvo) {
  const cfg = JSON.parse(JSON.stringify(CRACHA_PADRAO));
  if (salvo) {
    cfg.largura_mm = salvo.largura_mm ?? cfg.largura_mm;
    cfg.altura_mm = salvo.altura_mm ?? cfg.altura_mm;
    cfg.qr = salvo.qr !== false;
    cfg.linhas = cfg.linhas.map((l) => {
      const s = (salvo.linhas || []).find((x) => x.campo === l.campo);
      return s ? { ...l, ...s } : l;
    });
  }
  el("cfg-largura").value = cfg.largura_mm;
  el("cfg-altura").value = cfg.altura_mm;
  el("cfg-qr").checked = cfg.qr !== false;

  const opts = (tam) => {
    const sel = snapTamanho(Number(tam) || 18);
    return TAMANHOS_CRACHA.map((t) => `<option value="${t.valor}" ${sel === t.valor ? "selected" : ""}>${t.rotulo}</option>`).join("");
  };
  el("cfg-linhas").innerHTML = cfg.linhas.map((l) => {
    const fixo = CFG_FIXOS.includes(l.campo);
    return `<div class="ck-linha-cfg" data-campo="${l.campo}">
      <label class="ck-check-row"><input type="checkbox" data-on ${l.on !== false ? "checked" : ""} ${fixo ? "disabled" : ""} /> ${esc(CFG_ROTULOS[l.campo] || l.campo)}${fixo ? " (obrigatório)" : ""}
        ${l.campo === "texto" ? `<input class="ck-input" data-texto value="${esc(l.texto || "")}" placeholder="texto fixo" style="margin-top:6px;height:38px" />` : ""}
      </label>
      <select class="ck-select" data-tam>${opts(l.tam)}</select>
    </div>`;
  }).join("");
}

function lerConfigForm() {
  return {
    largura_mm: Number(el("cfg-largura").value) || 90,
    altura_mm: Number(el("cfg-altura").value) || 55,
    qr: el("cfg-qr").checked,
    linhas: [...el("cfg-linhas").querySelectorAll(".ck-linha-cfg")].map((row) => {
      const campo = row.dataset.campo;
      const o = {
        campo,
        on: CFG_FIXOS.includes(campo) ? true : row.querySelector("[data-on]").checked,
        tam: Number(row.querySelector("[data-tam]").value) || 14,
      };
      if (campo === "texto") o.texto = row.querySelector("[data-texto]").value.trim();
      return o;
    }),
  };
}

async function salvarConfig() {
  const btn = el("cfg-salvar");
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Salvando…";
  try {
    const nova = lerConfigForm();
    await salvarEventoPorId(evento.id, { cracha_config: nova });
    evento.cracha_config = nova;   // a prévia da etiqueta já usa o layout novo
    limparConfigCracha();
    toast("Configuração salva.", "ok");
  } catch (e) {
    toast(e.message || "Falha ao salvar.", "erro");
  } finally {
    btn.disabled = false; btn.textContent = antes;
  }
}

/* ---- atualização periódica dos check-ins ------------------------- */
let buscandoCheckins = false;   // com internet lenta, não empilha uma busca em cima da outra
setInterval(() => {
  if (!buscandoCheckins && !document.hidden && evento && el("app").hidden === false && !estaOffline() && OFF.pendentes === 0) {
    buscandoCheckins = true;
    listCheckins().then((c) => { checkins = c; }).catch(() => {}).finally(() => { buscandoCheckins = false; });
  }
}, 20000);
