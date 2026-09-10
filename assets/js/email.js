// =============================================================================
// Envio de e-mail para participantes (individual ou em massa).
// O disparo real acontece na Edge Function "enviar-email" (Resend). Modelos de
// mensagem ficam salvos no navegador. Placeholders: {nome} {codigo} {email} {evento}
// =============================================================================
import { esc, abrirModal, toast } from "./ui.js";
import { enviarEmail } from "./supabase.js";

const CHAVE_MODELOS = "email_modelos";

function lerModelos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_MODELOS) || "[]"); } catch { return []; }
}
function salvarModelos(m) {
  try { localStorage.setItem(CHAVE_MODELOS, JSON.stringify(m)); } catch {}
}

// participantes: lista de objetos { id, nome, email, ... }
export function abrirEnvioEmail(participantes, nomeEvento = "") {
  const alvos = (participantes || []).filter((p) => (p.email || "").includes("@"));
  if (!alvos.length) { toast("Nenhum destinatário com e-mail.", "erro"); return; }

  const modelos = lerModelos();
  const previa = alvos.slice(0, 8).map((p) => esc(p.email)).join(", ") + (alvos.length > 8 ? ` +${alvos.length - 8}` : "");

  abrirModal({
    titulo: alvos.length === 1 ? `E-mail para ${alvos[0].nome}` : `E-mail para ${alvos.length} participantes`,
    textoConfirmar: "Enviar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px"><b>${alvos.length}</b> destinatário(s): ${previa}</p>
      ${modelos.length ? `<label class="campo"><span>Modelo</span>
        <select class="select" name="modelo"><option value="">—</option>
          ${modelos.map((m, i) => `<option value="${i}">${esc(m.nome)}</option>`).join("")}</select></label>` : ""}
      <label class="campo"><span>Assunto *</span>
        <input class="input" name="assunto" required placeholder="Novidades sobre o evento" /></label>
      <label class="campo"><span>Mensagem *</span>
        <textarea class="input" name="corpo" rows="9" required placeholder="Olá {nome},&#10;&#10;..."></textarea></label>
      <p class="pagina-sub" style="margin:0">Use <code>{nome}</code>, <code>{codigo}</code>, <code>{email}</code>, <code>{evento}</code> — são trocados por participante.</p>
      <label class="campo" style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input type="checkbox" name="salvarModelo" /> <span style="margin:0">Salvar como modelo</span></label>
      <input class="input" name="nomeModelo" placeholder="Nome do modelo" style="display:none" />`,
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
    },
    onConfirmar: async (form) => {
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
}
