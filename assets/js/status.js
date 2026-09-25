// =============================================================================
// Acompanhamento público da inscrição — só por link (?c=<id>).
// A busca por e-mail foi retirada: ela devolvia status de inscrição pra
// qualquer e-mail digitado, sem provar que quem perguntou é o dono (LGPD).
// O convidado já recebe o link ?c=<id> na confirmação e na aprovação/recusa
// (via webhook/integração), então não há regressão de funcionalidade.
// =============================================================================
import { esc, formatarData } from "./ui.js";
import { APP } from "./config.js";
import { pubStatus } from "./publico-api.js";

const el = (id) => document.getElementById(id);
const idConvidado = new URLSearchParams(location.search).get("c");
let eventosCarregados = {};

el("marca").innerHTML = APP.marcaHtml;

function textoStatus(c) {
  const m = MAPA[c.status] || MAPA.Pendente;
  const ev = eventosCarregados[c.evento_id];
  return { m, texto: (ev && ev[m.chave]) || m.fallback };
}

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
  if (!idConvidado) { mostrarOrientacao(); return; }
  el("carregando").hidden = false;
  try {
    const r = await pubStatus(idConvidado);
    if (!r?.convidado) return semResultado();
    eventosCarregados = r.evento ? { [r.convidado.evento_id]: r.evento } : {};
    mostrarResultado(r.convidado);
  } catch (e) {
    console.error(e);
    mostrarOrientacao();
  }
  el("carregando").hidden = true;
})();

function mostrarOrientacao() {
  el("cartao-resultado").hidden = true;
  el("cartao-busca").hidden = false;
}

function semResultado() {
  el("busca-msg").textContent = "Não encontramos essa inscrição. Use o link que você recebeu por e-mail.";
  el("cartao-busca").hidden = false;
  el("cartao-resultado").hidden = true;
}

function mostrarResultado(c) {
  el("cartao-busca").hidden = true;
  el("cartao-resultado").hidden = false;
  const { m, texto } = textoStatus(c);
  el("resultado").innerHTML = `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <strong style="font-size:1.05rem">${esc(c.nome || "Inscrição")}</strong>
      <span class="badge ${m.cls}" style="font-size:.78rem">${m.rotulo}</span>
    </div>
    <p style="margin:8px 0 0;color:var(--texto-suave);line-height:1.5">${esc(texto)}</p>
    <p class="pagina-sub" style="margin:8px 0 0;font-size:.75rem">
      Convite de ${esc(c.anfitriao?.nome || "—")} · enviado em ${formatarData(c.created_at)}
    </p>
  </div>`;
}
