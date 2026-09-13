// =============================================================================
// Página pública de convite — formulário multi-passo montado a partir de
// form_perguntas. Sem sidebar, sem login.
// =============================================================================
import { esc, slugify } from "./ui.js";
import { APP } from "./config.js";
import { pubConvite, pubExisteEmail, pubEnviarConvite } from "./publico-api.js";

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Link curto (/convite-<slug>, via rewrite do Vercel) não chega com ?a= pro
// JS do navegador — o rewrite só decide qual arquivo servir, a URL visível
// (e o location do navegador) continua sendo a curta. Por isso lê o slug do
// caminho também; ?a= continua funcionando pros links antigos.
const slug = params.get("a") || location.pathname.match(/^\/convite-(.+)$/)?.[1] || null;
const utm = {
  utm_source: params.get("utm_source"),
  utm_medium: params.get("utm_medium"),
  utm_campaign: params.get("utm_campaign"),
};

const CHAVES_SISTEMA = ["nome", "email", "telefone", "empresa", "site", "faturamento", "funcionarios", "cnpj"];

/* ---- Máscaras --------------------------------------------------------- */
function maskTelefone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  let out = "(" + d.slice(0, 2);
  if (d.length > 2) out += ") " + d.slice(2, d.length > 10 ? 7 : 6);
  if (d.length > 6) out += "-" + d.slice(d.length > 10 ? 7 : 6, d.length > 10 ? 11 : 10);
  return out;
}

function maskCnpj(v) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (!d) return "";
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 5);
  if (d.length > 5) out += "." + d.slice(5, 8);
  if (d.length > 8) out += "/" + d.slice(8, 12);
  if (d.length > 12) out += "-" + d.slice(12, 14);
  return out;
}

let anfitriao = null;
let perguntas = [];
let config = null;
let passo = 0;
const respostas = {};

el("marca").innerHTML = APP.marcaHtml;

(async function iniciar() {
  if (!slug) return mostrarErro();
  try {
    const r = await pubConvite(slug);
    if (!r?.anfitriao) return mostrarErro();
    anfitriao = r.anfitriao;
    config = r.evento;
    perguntas = (r.perguntas || []).filter((p) => p.ativo);
    if (!perguntas.length) return mostrarErro();

    el("hero").innerHTML = `
      <h1><b>${esc(anfitriao.nome)}</b> convidou você</h1>
      <p>${esc(config?.subtitulo_convite || "Preencha sua aplicação abaixo.")}</p>`;

    if (config?.tema_convite === "nitro10x") {
      document.body.classList.add("tema-nitro10x");
      el("n10x-nome-anfitriao").textContent = anfitriao.nome;
      el("nitro10x").hidden = false;
      // vídeo só carrega de verdade (iframe do YouTube) quando a pessoa clica —
      // o embed sozinho pesava mais que o resto da página inteira
      el("n10x-video-play")?.addEventListener("click", function ativar() {
        this.outerHTML = `<iframe src="https://www.youtube.com/embed/O17ybCbS1FE?autoplay=1" title="Nitro 10X" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
      }, { once: true });
    }

    el("carregando").hidden = true;
    el("cartao").hidden = false;
    renderPasso();
  } catch (e) {
    console.error(e);
    mostrarErro("Não foi possível carregar o convite agora. Tente de novo em instantes.");
  }
})();

function mostrarErro(msg) {
  el("carregando").hidden = true;
  el("cartao").hidden = true;
  const box = el("erro");
  box.hidden = false;
  if (msg) box.innerHTML = `<h2 style="margin:0 0 8px">Ops</h2><p style="margin:0">${esc(msg)}</p>`;
}

/* ---- Passos ---------------------------------------------------------- */
function renderPasso() {
  const p = perguntas[passo];
  const total = perguntas.length;
  el("barra").style.width = ((passo) / total) * 100 + "%";
  el("contagem").textContent = `${passo + 1} de ${total}`;
  el("passo-erro").textContent = "";

  const valor = respostas[p.chave] || "";
  let campo;
  if (p.tipo === "selecao") {
    campo = `<div class="opcoes-radio" data-campo>
      ${(p.opcoes || [])
        .map(
          (o) => `<label class="${valor === o ? "marcado" : ""}">
            <input type="radio" name="opt" value="${esc(o)}" ${valor === o ? "checked" : ""} />
            <span>${esc(o)}</span></label>`
        )
        .join("")}</div>`;
  } else if (p.tipo === "textarea") {
    campo = `<textarea class="pub-input" data-campo rows="4">${esc(valor)}</textarea>`;
  } else {
    const tipoInput = { email: "email", telefone: "tel", url: "url" }[p.tipo] || "text";
    const ph = { url: "https://…", telefone: "(11) 99999-9999" }[p.tipo]
      || (p.chave === "cnpj" ? "00.000.000/0000-00" : "");
    campo = `<input class="pub-input" data-campo type="${tipoInput}" value="${esc(valor)}" placeholder="${ph}" />`;
  }

  el("passo").innerHTML = `
    <label class="pergunta-rotulo">${esc(p.rotulo)}${p.obrigatorio ? ' <span class="pergunta-obrig">*</span>' : ""}</label>
    ${campo}`;

  if (p.tipo === "selecao") {
    el("passo").querySelectorAll(".opcoes-radio label").forEach((lbl) => {
      lbl.querySelector("input").onchange = () => {
        el("passo").querySelectorAll(".opcoes-radio label").forEach((x) => x.classList.remove("marcado"));
        lbl.classList.add("marcado");
      };
    });
  } else {
    const inp = el("passo").querySelector("[data-campo]");
    inp.focus();
    inp.onkeydown = (e) => { if (e.key === "Enter" && p.tipo !== "textarea") { e.preventDefault(); avancar(); } };
    if (p.tipo === "telefone") inp.oninput = () => { inp.value = maskTelefone(inp.value); };
    else if (p.chave === "cnpj") inp.oninput = () => { inp.value = maskCnpj(inp.value); };
  }

  el("btn-voltar").hidden = passo === 0;
  el("btn-proximo").textContent = passo === total - 1 ? "Enviar aplicação" : "Próximo";
}

function lerCampo() {
  const p = perguntas[passo];
  if (p.tipo === "selecao") {
    return el("passo").querySelector('input[name="opt"]:checked')?.value || "";
  }
  return el("passo").querySelector("[data-campo]").value.trim();
}

function validar(p, v) {
  if (p.obrigatorio && !v) return "Este campo é obrigatório.";
  if (!v) return null;
  if (p.tipo === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "E-mail inválido.";
  if (p.tipo === "url" && !/^https?:\/\/.+\..+/.test(v)) return "Informe uma URL válida (com https://).";
  if (p.tipo === "telefone" && v.replace(/\D/g, "").length < 8) return "Telefone inválido.";
  return null;
}

async function avancar() {
  const p = perguntas[passo];
  const v = lerCampo();
  const erro = validar(p, v);
  if (erro) { el("passo-erro").textContent = erro; return; }

  if (p.tipo === "email" && v) {
    const btn = el("btn-proximo");
    btn.disabled = true;
    btn.textContent = "Verificando…";
    try {
      const duplicado = await pubExisteEmail(slug, v);
      if (duplicado) {
        el("passo-erro").textContent = "Este e-mail já está inscrito neste evento.";
        btn.disabled = false;
        btn.textContent = passo === perguntas.length - 1 ? "Enviar aplicação" : "Próximo";
        return;
      }
    } catch (e) {
      console.warn(e); // se a checagem falhar, deixa seguir — a inscrição não pode travar por isso
    }
    btn.disabled = false;
    btn.textContent = passo === perguntas.length - 1 ? "Enviar aplicação" : "Próximo";
  }

  respostas[p.chave] = v;

  if (passo < perguntas.length - 1) {
    passo++;
    renderPasso();
  } else {
    await enviar();
  }
}

function voltar() {
  respostas[perguntas[passo].chave] = lerCampo();
  passo--;
  renderPasso();
}

el("btn-proximo").onclick = avancar;
el("btn-voltar").onclick = voltar;

/* ---- Envio --------------------------------------------------------------- */
async function enviar() {
  const btn = el("btn-proximo");
  btn.disabled = true;
  btn.textContent = "Enviando…";

  const registro = {
    respostas: {},
    utm_source: utm.utm_source || "anfitriao",
    utm_medium: utm.utm_medium || slugify(anfitriao.nome),
    utm_campaign: utm.utm_campaign || null,
  };
  perguntas.forEach((p) => {
    const v = respostas[p.chave] ?? null;
    if (CHAVES_SISTEMA.includes(p.chave)) registro[p.chave] = v || null;
    else if (v) registro.respostas[p.chave] = v;
  });

  try {
    const novo = await pubEnviarConvite(slug, registro);
    el("cartao").hidden = true;
    el("link-acompanhar").hidden = true;
    el("sucesso").hidden = false;
    el("sucesso-texto").textContent =
      config?.texto_confirmacao || "Recebemos sua aplicação. Em breve nossa equipe entra em contato.";
    el("btn-acompanhar").href = `status.html?c=${novo.id}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error(e);
    el("passo-erro").textContent = "Não foi possível enviar agora. Tente de novo.";
    btn.disabled = false;
    btn.textContent = "Enviar aplicação";
  }
}
