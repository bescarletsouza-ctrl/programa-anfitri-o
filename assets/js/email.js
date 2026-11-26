// =============================================================================
// Envio de e-mail para participantes (individual ou em massa), com dois tipos:
//   • Mensagem personalizada: texto livre. Modelos salvos no navegador.
//   • Comprovante de inscrição: modelo pronto com os dados do evento e o QR Code de cada pessoa.
// O disparo real acontece na Edge Function "enviar-email" (Resend).
// Placeholders: {nome} {codigo} {email} {evento}
// =============================================================================
import { esc, abrirModal, toast, confirmar } from "./ui.js";
import { enviarEmail, pedirComprovante, getEvento } from "./supabase.js";
import { eventoId } from "./evento.js";

const CHAVE_MODELOS = "email_modelos";
const chaveComprovante = () => `email_comprovante_${eventoId() || ""}`;
const BLOCO_COMPROVANTE = 50;        // a função aceita até 50 por chamada
const LIMITE_DIA_GRATIS = 100;       // plano grátis do Resend

function lerModelos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_MODELOS) || "[]"); } catch { return []; }
}
function salvarModelos(m) {
  try { localStorage.setItem(CHAVE_MODELOS, JSON.stringify(m)); } catch {}
}
function lerComprovante() {
  try { return JSON.parse(localStorage.getItem(chaveComprovante()) || "null"); } catch { return null; }
}
function salvarComprovante(c) {
  try { localStorage.setItem(chaveComprovante(), JSON.stringify(c)); } catch {}
}
const dataBR = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const situacaoDe = (p) => p.situacao || "Confirmado";

// participantes: lista de objetos { id, nome, email, situacao, ... }
export function abrirEnvioEmail(participantes, nomeEvento = "") {
  const alvos = (participantes || []).filter((p) => (p.email || "").includes("@"));
  if (!alvos.length) { toast("Nenhum destinatário com e-mail.", "erro"); return; }

  const modelos = lerModelos();
  const previaEmails = alvos.slice(0, 8).map((p) => esc(p.email)).join(", ") + (alvos.length > 8 ? ` +${alvos.length - 8}` : "");
  const confirmados = alvos.filter((p) => situacaoDe(p) === "Confirmado");
  const desativados = alvos.filter((p) => situacaoDe(p) === "Desativado").length;
  const outros = alvos.length - confirmados.length - desativados;

  const salvo = lerComprovante();
  const c = {
    assunto: "Seu comprovante de inscrição: {evento}",
    mensagem: "Sua inscrição está confirmada! Guarde este e-mail: ele é o seu comprovante.",
    data: "", local: "", info: "", imagem: "",
    ...(salvo || {}),
  };

  let tipo = "personalizada";
  // quem vai receber o comprovante, conforme a caixinha "não confirmados" (desativado nunca)
  const recebemComprovante = (incluir) => alvos.filter((p) => situacaoDe(p) !== "Desativado" && (incluir || situacaoDe(p) === "Confirmado"));
  const camposComprovante = (form) => {
    const v = (n) => (form.querySelector(`[name="${n}"]`)?.value || "").trim();
    return { assunto: v("c_assunto"), mensagem: v("c_mensagem"), data: v("c_data"), local: v("c_local"), info: v("c_info"), imagem: v("c_imagem") };
  };

  abrirModal({
    titulo: alvos.length === 1 ? `E-mail para ${alvos[0].nome}` : `E-mail para ${alvos.length} participantes`,
    textoConfirmar: "Enviar",
    corpoHtml: `
      <label class="campo"><span>Tipo de e-mail</span>
        <select class="select" name="tipo">
          <option value="personalizada">Mensagem personalizada</option>
          <option value="comprovante">Comprovante de inscrição (com QR Code)</option>
        </select></label>

      <fieldset data-grupo="personalizada" style="border:0;padding:0;margin:0;min-width:0">
        <p class="pagina-sub" style="margin:0 0 10px"><b>${alvos.length}</b> destinatário(s): ${previaEmails}</p>
        ${modelos.length ? `<label class="campo"><span>Modelo salvo</span>
          <select class="select" name="modelo"><option value="">—</option>
            ${modelos.map((m, i) => `<option value="${i}">${esc(m.nome)}</option>`).join("")}</select></label>` : ""}
        <label class="campo"><span>Assunto *</span>
          <input class="input" name="assunto" required placeholder="Novidades sobre o evento" /></label>
        <label class="campo"><span>Mensagem *</span>
          <textarea class="input" name="corpo" rows="9" required placeholder="Olá {nome},&#10;&#10;..."></textarea></label>
        <p class="pagina-sub" style="margin:0">Use <code>{nome}</code>, <code>{codigo}</code>, <code>{email}</code>, <code>{evento}</code> — são trocados por participante.</p>
        <label class="campo" style="display:flex;gap:8px;align-items:center;margin-top:10px">
          <input type="checkbox" name="salvarModelo" /> <span style="margin:0">Salvar como modelo</span></label>
        <input class="input" name="nomeModelo" placeholder="Nome do modelo" style="display:none" />
      </fieldset>

      <fieldset data-grupo="comprovante" style="border:0;padding:0;margin:0;min-width:0" hidden disabled>
        <p class="pagina-sub" style="margin:0 0 8px" id="c-resumo"></p>
        ${outros ? `<label class="campo" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="c_incluir" /> <span style="margin:0">Enviar também para quem <b>não está Confirmado</b> (${outros})</span></label>` : ""}
        <label class="campo"><span>Assunto *</span>
          <input class="input" name="c_assunto" required value="${esc(c.assunto)}" /></label>
        <label class="campo"><span>Mensagem de abertura</span>
          <textarea class="input" name="c_mensagem" rows="3">${esc(c.mensagem)}</textarea></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="campo"><span>Data e horário</span>
            <input class="input" name="c_data" value="${esc(c.data)}" placeholder="03 a 05/12, a partir das 8h" /></label>
          <label class="campo"><span>Local</span>
            <input class="input" name="c_local" value="${esc(c.local)}" /></label>
        </div>
        <label class="campo"><span>Informações adicionais</span>
          <textarea class="input" name="c_info" rows="3" placeholder="Endereço completo, orientações, contato…">${esc(c.info)}</textarea></label>
        <label class="campo"><span>Imagem do topo (link https, opcional)</span>
          <input class="input" name="c_imagem" value="${esc(c.imagem)}" placeholder="https://…/banner.png" /></label>
        <p class="pagina-sub" style="margin:0 0 10px">O comprovante já leva <b>nome, categoria, código e o QR Code</b> de cada pessoa (o mesmo que o app de check-in lê).</p>
        <button type="button" class="btn btn-secundario btn-sm" id="c-previa">Ver prévia</button>
        <div id="c-previa-area" style="margin-top:12px"></div>
      </fieldset>`,
    aoMontar: (root) => {
      const sel = root.querySelector('[name="modelo"]');
      if (sel) sel.onchange = () => {
        const m = modelos[sel.value];
        if (!m) return;
        root.querySelector('[name="assunto"]').value = m.assunto || "";
        root.querySelector('[name="corpo"]').value = m.corpo || "";
      };
      const chk = root.querySelector('[name="salvarModelo"]');
      const nm = root.querySelector('[name="nomeModelo"]');
      chk.onchange = () => { nm.style.display = chk.checked ? "block" : "none"; };

      const incluir = root.querySelector('[name="c_incluir"]');
      const resumo = () => {
        const n = recebemComprovante(!!incluir?.checked).length;
        root.querySelector("#c-resumo").innerHTML = `Vão receber o comprovante: <b>${n}</b> pessoa(s).`
          + (desativados ? ` ${desativados} desativado(s) não recebem.` : "")
          + (n > LIMITE_DIA_GRATIS ? ` <b>Atenção:</b> o plano grátis do Resend envia até ${LIMITE_DIA_GRATIS} por dia.` : "");
      };
      if (incluir) incluir.onchange = resumo;
      resumo();

      // troca de tipo: o grupo escondido fica desativado (não trava a validação do outro)
      root.querySelector('[name="tipo"]').onchange = (e) => {
        tipo = e.target.value;
        root.querySelectorAll("[data-grupo]").forEach((g) => {
          const ativo = g.dataset.grupo === tipo;
          g.hidden = !ativo;
          g.disabled = !ativo;
        });
      };

      // primeira vez neste evento: data e local vêm do cadastro do evento
      if (!salvo) {
        getEvento(eventoId()).then((ev) => {
          const data = root.querySelector('[name="c_data"]'), local = root.querySelector('[name="c_local"]');
          if (data && !data.value) data.value = dataBR(ev?.data_evento);
          if (local && !local.value) local.value = ev?.local || "";
        }).catch(() => {});
      }

      const btnPrevia = root.querySelector("#c-previa");
      btnPrevia.onclick = async () => {
        const area = root.querySelector("#c-previa-area");
        const campos = camposComprovante(root);
        if (!campos.assunto) { toast("Preencha o assunto.", "erro"); return; }
        salvarComprovante(campos);
        btnPrevia.disabled = true;
        area.innerHTML = `<p class="pagina-sub" style="margin:0">Montando a prévia…</p>`;
        try {
          const exemplo = recebemComprovante(!!incluir?.checked)[0] || alvos[0];
          const r = await pedirComprovante({ participanteIds: [exemplo.id], previa: true, ...campos });
          area.innerHTML = `<p class="pagina-sub" style="margin:0 0 6px">Prévia com os dados de <b>${esc(exemplo.nome)}</b> · Assunto: ${esc(r.assunto)}</p>
            <iframe title="Prévia do comprovante" sandbox="" style="width:100%;height:520px;border:1px solid var(--borda);border-radius:10px;background:#fff"></iframe>`;
          area.querySelector("iframe").srcdoc = r.html;
        } catch (e) {
          area.innerHTML = `<p class="pagina-sub" style="margin:0;color:var(--erro)">${esc(e.message || "Não foi possível montar a prévia.")}</p>`;
        } finally {
          btnPrevia.disabled = false;
        }
      };
    },
    onConfirmar: async (form) => {
      if (tipo === "comprovante") return enviarComprovantesEmBlocos(form);

      const f = Object.fromEntries(new FormData(form));
      const assunto = (f.assunto || "").trim();
      const corpo = (f.corpo || "").trim();
      if (!assunto || !corpo) { toast("Preencha assunto e mensagem.", "erro"); return false; }

      if (f.salvarModelo && (f.nomeModelo || "").trim()) {
        const m = lerModelos();
        m.push({ nome: f.nomeModelo.trim(), assunto, corpo });
        salvarModelos(m);
      }

      toast("Enviando…");
      try {
        const r = await enviarEmail({ participanteIds: alvos.map((p) => p.id), assunto, corpo });
        const falhas = r?.falhas?.length || 0;
        toast(`${r?.enviados ?? 0} e-mail(s) enviado(s).` + (falhas ? ` ${falhas} falha(s).` : ""), falhas ? "erro" : "ok");
      } catch (e) {
        toast(e.message || "Falha ao enviar.", "erro");
        return false;
      }
    },
  });

  async function enviarComprovantesEmBlocos(form) {
    const campos = camposComprovante(form);
    if (!campos.assunto) { toast("Preencha o assunto.", "erro"); return false; }
    const incluir = !!form.querySelector('[name="c_incluir"]')?.checked;
    const lista = recebemComprovante(incluir);
    if (!lista.length) { toast("Ninguém para receber: nenhum participante Confirmado na seleção.", "erro"); return false; }
    if (!confirmar(`Enviar o comprovante de inscrição para ${lista.length} pessoa(s)?`)) return false;
    salvarComprovante(campos);

    let enviados = 0, falhas = [], parou = "";
    for (let i = 0; i < lista.length; i += BLOCO_COMPROVANTE) {
      toast(`Enviando comprovantes… ${i} de ${lista.length}`);
      try {
        const r = await pedirComprovante({
          participanteIds: lista.slice(i, i + BLOCO_COMPROVANTE).map((p) => p.id), incluirNaoConfirmados: incluir, ...campos,
        });
        enviados += r?.enviados || 0;
        falhas = falhas.concat(r?.falhas || []);
        if (r?.limite_atingido) { parou = "O limite de envios do Resend foi atingido."; break; }
      } catch (e) {
        parou = e.message || "Falha ao enviar.";
        break;
      }
    }

    if (!parou && !falhas.length) { toast(`${enviados} comprovante(s) enviado(s).`, "ok"); return true; }
    // algo não foi: mostra quem ficou de fora, pra reenviar só pra eles
    const resto = lista.length - enviados;
    abrirModal({
      titulo: "Envio incompleto",
      textoConfirmar: "Entendi",
      corpoHtml: `<p style="margin:0 0 8px"><b>${enviados}</b> enviado(s) e <b>${resto}</b> sem enviar.</p>
        ${parou ? `<p style="margin:0 0 8px">${esc(parou)}</p>` : ""}
        ${falhas.length ? `<div style="max-height:240px;overflow:auto">${falhas.slice(0, 100).map((x) => `<p class="pagina-sub" style="margin:0 0 4px">${esc(x.email)}: ${esc(x.erro)}</p>`).join("")}</div>` : ""}
        <p class="pagina-sub" style="margin:8px 0 0">Quem já recebeu não precisa de novo: ao reenviar, selecione só quem ficou de fora.</p>`,
    });
    return true;
  }
}
