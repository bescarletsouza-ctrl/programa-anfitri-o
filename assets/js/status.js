// =============================================================================
// Acompanhamento público da inscrição — por link (?c=<id>) ou por e-mail.
// =============================================================================
import { esc, formatarData } from "./ui.js";
import { APP } from "./config.js";
import { getConvidadoStatus, listConvidadosPorEmail, getConfig } from "./supabase.js";

const el = (id) => document.getElementById(id);
const idConvidado = new URLSearchParams(location.search).get("c");
let config = null;

el("marca").innerHTML = APP.marcaHtml;

const MAPA = {
  Pendente: { rotulo: "Em análise", cls: "badge-alerta", chave: "texto_em_analise",
    fallback: "Sua aplicação está em análise. Avisaremos assim que houver uma resposta." },
  Aprovado: { rotulo: "Aprovado", cls: "badge-ok", chave: "texto_aprovado",
    fallback: "Sua aplicação foi aprovada! Em breve entramos em contato." },
  Confirmado: { rotulo: "Presença confirmada", cls: "badge-ok", chave: "texto_aprovado",
    fallback: "Sua presença está confirmada. Nos vemos em breve!" },
  Recusado: { rotulo: "Não aprovado", cls: "badge-erro", chave: "texto_recusado",
    fallback: "Desta vez sua aplicação não foi aprovada. Obrigado pelo interesse." },
};

(async function iniciar() {
  config = await getConfig().catch(() => null);
  if (idConvidado) {
    el("carregando").hidden = false;
    try {
      const c = await getConvidadoStatus(idConvidado);
      if (!c) return semResultado("Não encontramos essa inscrição.");
      mostrarResultado([c], null);
    } catch (e) {
      console.error(e);
      mostrarBusca();
    }
    el("carregando").hidden = true;
  } else {
    mostrarBusca();
  }
})();

function mostrarBusca() {
  el("cartao-resultado").hidden = true;
  el("cartao-busca").hidden = false;
}

el("form-busca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = el("email").value.trim();
  el("busca-erro").textContent = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    el("busca-erro").textContent = "Informe um e-mail válido.";
    return;
  }
  const btn = el("btn-buscar");
  btn.disabled = true;
  btn.textContent = "Buscando…";
  try {
    const lista = await listConvidadosPorEmail(email);
    if (!lista.length) return semResultado("Não encontramos nenhuma inscrição com esse e-mail.");
    mostrarResultado(lista, email);
  } catch (err) {
    console.error(err);
    el("busca-erro").textContent = "Não foi possível consultar agora. Tente de novo.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Ver status";
  }
});

el("btn-voltar").onclick = () => {
  history.replaceState(null, "", location.pathname);
  el("email").value = "";
  mostrarBusca();
};

function semResultado(msg) {
  el("cartao-busca").hidden = false;
  el("cartao-resultado").hidden = true;
  el("busca-erro").textContent = msg;
}

function mostrarResultado(lista, email) {
  el("cartao-busca").hidden = true;
  el("cartao-resultado").hidden = false;
  el("resultado").innerHTML =
    (email ? `<p class="pagina-sub" style="margin:0 0 14px">Inscrições de <b>${esc(email)}</b></p>` : "") +
    lista
      .map((c) => {
        const m = MAPA[c.status] || MAPA.Pendente;
        const texto = (config && config[m.chave]) || m.fallback;
        return `<div style="padding:16px 0;border-bottom:1px solid var(--cinza-100)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <strong style="font-size:1.05rem">${esc(c.nome || "Inscrição")}</strong>
            <span class="badge ${m.cls}" style="font-size:.78rem">${m.rotulo}</span>
          </div>
          <p style="margin:8px 0 0;color:var(--texto-suave);line-height:1.5">${esc(texto)}</p>
          <p class="pagina-sub" style="margin:8px 0 0;font-size:.75rem">
            Convite de ${esc(c.anfitriao?.nome || "—")} · enviado em ${formatarData(c.created_at)}
          </p>
        </div>`;
      })
      .join("");
  el("resultado").lastElementChild?.style.setProperty("border-bottom", "none");
}
