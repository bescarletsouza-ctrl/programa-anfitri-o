// =============================================================================
// UI compartilhada: ícones, sidebar, tema, formatação, toast, modal, gaveta.
// =============================================================================
import { APP } from "./config.js";
import { CONFIGURADO, listEventos } from "./supabase.js";
import { eventoId, eventoNome, definirEvento, exigirEvento } from "./evento.js";

/* ---- Ícones (feather-style, stroke currentColor) --------------------- */
const PATHS = {
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  painel: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/>',
  anfitrioes: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  convidados: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  participantes: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3.5" y1="6" x2="3.51" y2="6"/><line x1="3.5" y1="12" x2="3.51" y2="12"/><line x1="3.5" y1="18" x2="3.51" y2="18"/>',
  formulario: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"/>',
  editar: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  excluir: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  mais: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  busca: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  filtro: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.4 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>',
};

export function icone(nome, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[nome] || ""}</svg>`;
}

/* ---- Tema (claro / escuro) ------------------------------------------- */
export function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("tema", t); } catch {}
  document.querySelectorAll("[data-toggle-tema]").forEach((b) => {
    b.innerHTML = t === "dark"
      ? icone("sol") + "<span>Tema claro</span>"
      : icone("lua") + "<span>Tema escuro</span>";
  });
}
function alternarTema() {
  aplicarTema(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/* ---- Navegação -------------------------------------------------------- */
const NAV = [
  { chave: "painel",        rotulo: "Painel",                  href: "index.html",         ico: "painel" },
  { chave: "anfitrioes",    rotulo: APP.termoAnfitriaoPlural,  href: "anfitrioes.html",    ico: "anfitrioes" },
  { chave: "convidados",    rotulo: APP.termoConvidadoPlural,  href: "convidados.html",    ico: "convidados" },
  { chave: "participantes", rotulo: "Participantes",           href: "participantes.html", ico: "participantes" },
  { chave: "formulario",    rotulo: "Formulário de inscrição", href: "formulario.html",    ico: "formulario" },
  { chave: "config",        rotulo: "Configurações",           href: "configuracoes.html", ico: "config" },
];

export function renderSidebar(ativo) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  el.className = "sidebar";
  el.innerHTML = `
    <div class="marca">${APP.marcaHtml}</div>
    <div class="evento-box">
      <select class="evento-sel" data-evento-sel aria-label="Evento">
        <option value="${esc(eventoId() || "")}">${esc(eventoNome() || "Selecionar evento")}</option>
      </select>
      <a class="evento-gerenciar" href="eventos.html">Gerenciar eventos</a>
    </div>
    <nav>
      ${NAV.map(
        (n) => `<a class="nav-link ${n.chave === ativo ? "ativo" : ""}" href="${n.href}">${icone(n.ico)}<span>${n.rotulo}</span></a>`
      ).join("")}
    </nav>
    <div class="rodape">
      <button class="btn-tema" data-toggle-tema type="button"></button>
      <div class="usuario">${APP.nomeProduto}</div>
    </div>`;
  aplicarTema(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  el.querySelector("[data-toggle-tema]").onclick = alternarTema;
  montarTopbarMobile(el);
  popularSeletorEvento(el);
}

async function popularSeletorEvento(sidebar) {
  const sel = sidebar.querySelector("[data-evento-sel]");
  if (!sel) return;
  let eventos;
  try { eventos = await listEventos(); } catch { return; }
  const atual = eventoId();
  sel.innerHTML = eventos
    .map((e) => `<option value="${esc(e.id)}" ${e.id === atual ? "selected" : ""}>${esc(e.nome)}</option>`)
    .join("");
  sel.onchange = () => {
    definirEvento(sel.value, sel.options[sel.selectedIndex].text);
    location.reload();
  };
}

function montarTopbarMobile(sidebar) {
  const conteudo = document.querySelector(".conteudo");
  if (!conteudo || document.querySelector(".topbar-mobile")) return;
  const tb = document.createElement("div");
  tb.className = "topbar-mobile";
  tb.innerHTML = `<button class="abrir-menu" aria-label="Abrir menu">${icone("menu")}</button><div class="marca">${APP.marcaHtml}</div>`;
  conteudo.prepend(tb);
  const fundo = document.createElement("div");
  fundo.className = "sidebar-fundo";
  document.body.appendChild(fundo);
  const fechar = () => { sidebar.classList.remove("aberta"); fundo.classList.remove("aberta"); };
  tb.querySelector(".abrir-menu").onclick = () => { sidebar.classList.add("aberta"); fundo.classList.add("aberta"); };
  fundo.onclick = fechar;
  sidebar.querySelectorAll(".nav-link").forEach((a) => a.addEventListener("click", fechar));
}

/* ---- Datas (fuso Brasília) ------------------------------------------------ */
const TZ = "America/Sao_Paulo";

export function formatarData(iso, comHora = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const opt = { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" };
  let s = new Intl.DateTimeFormat("pt-BR", opt).format(d);
  if (comHora) {
    const h = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
    s += " " + h;
  }
  return s;
}

export function dataPorExtenso(date = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(date);
}

/* ---- Utils -------------------------------------------------------------- */
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function telParaWhatsApp(tel) {
  const num = String(tel || "").replace(/\D/g, "");
  if (!num) return null;
  return "https://wa.me/" + (num.length <= 11 ? "55" + num : num);
}

/* ---- Toast ------------------------------------------------------------- */
export function toast(msg, tipo = "") {
  let wrap = document.getElementById("toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toasts";
    document.body.appendChild(wrap);
  }
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.innerHTML = (tipo === "ok" ? icone("check") : "") + `<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function confirmar(msg) {
  return window.confirm(msg);
}

/* ---- Modal dinâmico -------------------------------------------------- */
export function abrirModal({ titulo, corpoHtml, textoConfirmar = "Salvar", onConfirmar, aoMontar }) {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo aberto";
  fundo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="cabecalho">
        <h2>${esc(titulo)}</h2>
        <button class="icone-btn" data-fechar aria-label="Fechar">${icone("x")}</button>
      </div>
      <form class="corpo">${corpoHtml}</form>
      <div class="rodape">
        <button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
        <button type="button" class="btn btn-primario" data-confirmar>${esc(textoConfirmar)}</button>
      </div>
    </div>`;
  document.body.appendChild(fundo);

  const fechar = () => fundo.remove();
  fundo.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = fechar));
  fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
  document.addEventListener("keydown", function esc2(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", esc2); }
  });

  const form = fundo.querySelector("form");
  const btn = fundo.querySelector("[data-confirmar]");
  btn.onclick = async () => {
    if (form && !form.reportValidity()) return;
    btn.disabled = true;
    try {
      const r = await onConfirmar?.(form);
      if (r !== false) fechar();
    } catch (e) {
      toast(e.message || "Erro ao salvar.", "erro");
    } finally {
      btn.disabled = false;
    }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); btn.click(); });

  aoMontar?.(fundo);
  form.querySelector("input, select, textarea")?.focus();
  return { fechar, elemento: fundo };
}

/* ---- Gaveta (drawer) ------------------------------------------------- */
export function abrirGaveta(tituloHtml, corpoHtml) {
  const g = document.getElementById("gaveta");
  const f = document.getElementById("gaveta-fundo");
  g.querySelector(".cabecalho h2").innerHTML = tituloHtml;
  g.querySelector(".corpo").innerHTML = corpoHtml;
  g.querySelector(".corpo").scrollTop = 0;
  f.classList.add("aberta");
  g.classList.add("aberta");
}

export function fecharGaveta() {
  document.getElementById("gaveta")?.classList.remove("aberta");
  document.getElementById("gaveta-fundo")?.classList.remove("aberta");
}

export function montarGaveta() {
  if (document.getElementById("gaveta")) return;
  const f = document.createElement("div");
  f.id = "gaveta-fundo";
  f.className = "gaveta-fundo";
  const g = document.createElement("aside");
  g.id = "gaveta";
  g.className = "gaveta";
  g.innerHTML = `
    <div class="cabecalho"><h2></h2>
      <button class="icone-btn" id="gaveta-fechar" aria-label="Fechar">${icone("x")}</button>
    </div>
    <div class="corpo"></div>`;
  document.body.append(f, g);
  f.onclick = fecharGaveta;
  g.querySelector("#gaveta-fechar").onclick = fecharGaveta;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
}

/* ---- Boilerplate de página ----------------------------------------- */
export function iniciarPagina(chaveNav) {
  exigirEvento();
  renderSidebar(chaveNav);
  montarGaveta();
  if (!CONFIGURADO) {
    const alvo = document.querySelector(".conteudo");
    if (alvo && !document.getElementById("aviso-config")) {
      const d = document.createElement("div");
      d.id = "aviso-config";
      d.className = "aviso";
      d.innerHTML =
        "Supabase não configurado. Preencha <code>SUPABASE_URL</code> e " +
        "<code>SUPABASE_ANON_KEY</code> em <code>assets/js/config.js</code> (veja o README).";
      alvo.querySelector(".topbar-mobile")?.after(d) || alvo.prepend(d);
    }
  }
}
