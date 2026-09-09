// =============================================================================
// Check-in / credenciamento — busca rápida do participante e marca presença.
// Ao credenciar, abre o crachá para impressão (nome, empresa, tipo, QR).
// =============================================================================
import { iniciarPagina, esc, debounce, toast } from "./ui.js";
import { listParticipantes, salvar } from "./supabase.js";
import { eventoNome } from "./evento.js";
import { imprimirCracha } from "./cracha.js";

iniciarPagina("checkin");
const el = (id) => document.getElementById(id);

let participantes = [];
let termo = "";

carregar();
el("btn-atualizar").onclick = () => carregar();
el("busca").addEventListener("input", debounce((e) => { termo = e.target.value.trim().toLowerCase(); render(); }, 150));
setInterval(() => { if (!document.hidden) carregar(); }, 30000);

async function carregar() {
  try {
    participantes = await listParticipantes();
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
    el("busca").focus();
  } catch (e) {
    const falta = /participantes|codigo|presente|column/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0006_checkin.sql</code> no SQL Editor do Supabase para ativar o check-in.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

function hora(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return ""; }
}

function render() {
  const total = participantes.length;
  const presentes = participantes.filter((p) => p.presente).length;
  el("n-presentes").textContent = presentes;
  el("n-total").textContent = total;
  el("checkin-progresso").style.width = total ? Math.round((presentes / total) * 100) + "%" : "0%";

  if (!termo) {
    el("resultados").innerHTML = "";
    el("dica").hidden = false;
    el("dica").textContent = "Digite para localizar o participante.";
    return;
  }

  const achados = participantes
    .filter((p) => {
      const alvo = `${p.nome} ${p.email || ""} ${p.telefone || ""} ${p.codigo || ""} ${p.empresa || ""}`.toLowerCase();
      return alvo.includes(termo);
    })
    .slice(0, 30);

  el("dica").hidden = achados.length > 0;
  if (!achados.length) {
    el("dica").textContent = "Ninguém encontrado com esse termo.";
    el("resultados").innerHTML = "";
    return;
  }

  el("resultados").innerHTML = achados
    .map((p) => {
      const sub = [p.empresa, p.email, p.telefone].filter(Boolean).join(" · ");
      return `<div class="checkin-item ${p.presente ? "presente" : ""}" data-id="${p.id}">
        <div class="checkin-item-info">
          <strong>${esc(p.nome)}</strong>
          <span class="checkin-meta">
            <span class="badge ${p.tipo === "Anfitrião" ? "badge-laranja" : "badge-neutro"}">${esc(p.tipo)}</span>
            <span class="chip-codigo">${esc(p.codigo || "—")}</span>
            ${sub ? `<span class="checkin-sub">${esc(sub)}</span>` : ""}
          </span>
        </div>
        <div class="checkin-item-acao">
          ${p.presente
            ? `<span class="checkin-ok">✓ ${esc(hora(p.checkin_at)) || "presente"}</span>
               <button class="btn btn-fantasma btn-sm" data-desfazer>Desfazer</button>`
            : `<button class="btn btn-primario" data-credenciar>Credenciar</button>`}
        </div>
      </div>`;
    })
    .join("");

  el("resultados").querySelectorAll(".checkin-item").forEach((row) => {
    const p = participantes.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-credenciar]")?.addEventListener("click", () => credenciar(p, true));
    row.querySelector("[data-desfazer]")?.addEventListener("click", () => credenciar(p, false));
  });
}

async function credenciar(p, entrar) {
  try {
    const patch = entrar
      ? { id: p.id, presente: true, checkin_at: new Date().toISOString() }
      : { id: p.id, presente: false, checkin_at: null };
    const salvo = await salvar("participantes", patch);
    Object.assign(p, salvo);
    render();
    if (entrar) {
      toast(`${p.nome} credenciado(a).`, "ok");
      imprimirCracha(p, eventoNome());
    } else {
      toast("Presença removida.", "ok");
    }
  } catch (e) {
    toast(e.message, "erro");
  }
}
