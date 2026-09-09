// =============================================================================
// UI compartilhada: sidebar, formatação, toast, modal, gaveta.
// =============================================================================
import { APP } from "./config.js";
import { CONFIGURADO } from "./supabase.js";

/* ---- Navegação --------------------------------------------------------- */
const NAV = [
  { chave: "painel",       rotulo: "Painel",                  href: "index.html" },
  { chave: "anfitrioes",   rotulo: APP.termoAnfitriaoPlural,  href: "anfitrioes.html" },
  { chave: "convidados",   rotulo: APP.termoConvidadoPlural,  href: "convidados.html" },
  { chave: "participantes", rotulo: "Participantes",           href: "participantes.html" },
  { chave: "formulario",   rotulo: "Formulário de inscrição", href: "formulario.html" },
  { chave: "config",       rotulo: "Configurações",           href: "configuracoes.html" },
];

export function renderSidebar(ativo) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  el.className = "sidebar";
  el.innerHTML = `
    <div class="marca">${APP.marcaHtml}</div>
    <nav>
      ${NAV.map(
        (n) => `<a class="nav-link ${n.chave === ativo ? "ativo" : ""}" href="${n.href}">${n.rotulo}</a>`
      ).join("")}
    </nav>
    <div class="rodape">${APP.nomeProduto}<br>painel interno</div>
  `;
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
    const h = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit",
    }).format(d);
    s += " " + h;
  }
  return s;
}

export function dataPorExtenso(date = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long",
  }).format(date);
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
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---- Confirmação simples --------------------------------------------- */
export function confirmar(msg) {
  return window.confirm(msg);
}

/* ---- Modal dinâmico -------------------------------------------------- */
// abrirModal({ titulo, corpoHtml, textoConfirmar, onConfirmar, aoMontar })
// onConfirmar recebe o <form> (se houver) — retorne false para não fechar.
export function abrirModal({ titulo, corpoHtml, textoConfirmar = "Salvar", onConfirmar, aoMontar }) {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo aberto";
  fundo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="cabecalho">
        <h2>${esc(titulo)}</h2>
        <button class="icone-btn" data-fechar aria-label="Fechar">✕</button>
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
// Usa #gaveta / #gaveta-fundo, criados por montarGaveta().
export function abrirGaveta(tituloHtml, corpoHtml) {
  const g = document.getElementById("gaveta");
  const f = document.getElementById("gaveta-fundo");
  g.querySelector(".cabecalho h2").innerHTML = tituloHtml;
  g.querySelector(".corpo").innerHTML = corpoHtml;
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
      <button class="icone-btn" id="gaveta-fechar" aria-label="Fechar">✕</button>
    </div>
    <div class="corpo"></div>`;
  document.body.append(f, g);
  f.onclick = fecharGaveta;
  g.querySelector("#gaveta-fechar").onclick = fecharGaveta;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
}

/* ---- Boilerplate de página ----------------------------------------- */
export function iniciarPagina(chaveNav) {
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
        "<code>SUPABASE_ANON_KEY</code> em <code>assets/js/config.js</code> " +
        "(veja o README). Enquanto isso, nenhum dado carrega.";
      alvo.prepend(d);
    }
  }
}
