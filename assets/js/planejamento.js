// =============================================================================
// Planejamento — metas de inscritos/presentes (geral, multiplicador, compradores,
// showrate) e a quebra por Tipo × categoria de ingresso (ex.: LIFE / MASTER).
// Metas ficam em eventos.metas_planejamento (jsonb), editáveis em "Ajustar metas".
// Contagens são sempre calculadas ao vivo a partir de listParticipantes().
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast } from "./ui.js";
import { listParticipantes, listTiposIngresso, getEvento, salvarEvento } from "./supabase.js";
import { eventoId } from "./evento.js";

const _iniciando = iniciarPagina("planejamento");
const el = (id) => document.getElementById(id);

let participantes = [];
let tiposIngresso = [];
let evento = null;

const METAS_PADRAO = {
  ingresso_a: "", ingresso_b: "",
  geral: { inscritos: 0, presentes: 0 },
  multiplicador: { inscritos: 0, presentes: 0 },
  compradores: { inscritos: 0, presentes: 0 },
  showrate: { convidado: 0, comprador: 0 },
};
const metasAtuais = () => ({
  ...METAS_PADRAO, ...(evento?.metas_planejamento || {}),
  geral: { ...METAS_PADRAO.geral, ...(evento?.metas_planejamento?.geral || {}) },
  multiplicador: { ...METAS_PADRAO.multiplicador, ...(evento?.metas_planejamento?.multiplicador || {}) },
  compradores: { ...METAS_PADRAO.compradores, ...(evento?.metas_planejamento?.compradores || {}) },
  showrate: { ...METAS_PADRAO.showrate, ...(evento?.metas_planejamento?.showrate || {}) },
});

_iniciando.then((ctx) => { if (ctx) carregar(ctx); });
el("btn-metas").onclick = modalMetas;

async function carregar() {
  try {
    [participantes, tiposIngresso, evento] = await Promise.all([
      listParticipantes(),
      listTiposIngresso().catch(() => []),
      getEvento(eventoId()),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    el("carregando").innerHTML = /participantes|does not exist/.test(e.message || "")
      ? `Rode a migração <code>supabase/migrations/0004_participantes.sql</code> para ativar esta tela.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

/* ---- contagens ao vivo ---- */
const ativo = (p) => (p.situacao || "Confirmado") !== "Desativado";
const catDe = (p) => (p.ingresso || "").trim();

// tipos: array de p.tipo aceitos (null = qualquer); cat: categoria de ingresso
// exigida (null = qualquer; "" = categoria ainda não configurada → zera).
function grupo(tipos, cat) {
  if (cat === "") return { inscritos: 0, presentes: 0 };
  const alvo = participantes.filter(ativo).filter((p) => {
    if (tipos && !tipos.includes(p.tipo)) return false;
    if (cat != null && catDe(p) !== cat) return false;
    return true;
  });
  return { inscritos: alvo.length, presentes: alvo.filter((p) => p.presente).length };
}

function render() {
  const metas = metasAtuais();
  const A = metas.ingresso_a, B = metas.ingresso_b;

  const geral = grupo(null, null);
  const multiplicador = grupo(["Convidado", "Acompanhante"], null);
  const compradores = grupo(["Comprador"], null);

  el("metas-principais").innerHTML = [
    cardMeta("Meta geral", geral, metas.geral),
    cardMeta(`Multiplicador${A || B ? ` (${[A, B].filter(Boolean).join(" + ")})` : ""}`, multiplicador, metas.multiplicador),
    cardMeta("Compradores", compradores, metas.compradores),
  ].join("");

  const rateConvidado = multiplicador.inscritos > 0 ? Math.round((multiplicador.presentes / multiplicador.inscritos) * 100) : 0;
  const rateComprador = compradores.inscritos > 0 ? Math.round((compradores.presentes / compradores.inscritos) * 100) : 0;
  el("metas-showrate").innerHTML =
    linhaShowrate("Convidado / acompanhante", rateConvidado, metas.showrate.convidado) +
    linhaShowrate("Comprador", rateComprador, metas.showrate.comprador);

  el("quebra-aviso").hidden = !!(A && B);
  el("quebra-categorias").innerHTML = (A || B) ? [
    statCard(`Qtd. ${A || "Categoria A"}`, grupo(null, A)),
    statCard(`Qtd. ${B || "Categoria B"}`, grupo(null, B)),
    statCard(`Convidado ${A || "A"}`, grupo(["Convidado"], A)),
    statCard(`Convidado ${B || "B"}`, grupo(["Convidado"], B)),
    statCard("Comprador", grupo(["Comprador"], null)),
    statCard(`Acompanhante ${A || "A"}`, grupo(["Acompanhante"], A)),
    statCard(`Acompanhante ${B || "B"}`, grupo(["Acompanhante"], B)),
  ].join("") : "";
}

function pct(atual, alvo) { return alvo > 0 ? Math.min(100, Math.round((atual / alvo) * 100)) : 0; }

function barraHtml(rotulo, atual, alvo) {
  const p = pct(atual, alvo);
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:5px">
      <span class="pagina-sub" style="margin:0">${esc(rotulo)}</span>
      <span><b>${atual}</b> / ${alvo} <span class="cel-tenue">(${p}%)</span></span>
    </div>
    <div class="checkin-barra"><i style="width:${p}%"></i></div>
  </div>`;
}

function cardMeta(titulo, atual, alvo) {
  return `<div class="card">
    <h3 style="margin:0 0 14px">${esc(titulo)}</h3>
    ${barraHtml("Inscritos", atual.inscritos, alvo.inscritos)}
    ${barraHtml("Presentes", atual.presentes, alvo.presentes)}
  </div>`;
}

function linhaShowrate(rotulo, atualPct, metaPct) {
  const ok = atualPct >= metaPct;
  return `<div style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:5px">
      <span>${esc(rotulo)}</span>
      <span><b>${atualPct}%</b> <span class="cel-tenue">(meta ${metaPct}%)</span></span>
    </div>
    <div class="checkin-barra"><i style="width:${Math.min(100, atualPct)}%;background:${ok ? "var(--ok-solid)" : "var(--erro)"}"></i></div>
  </div>`;
}

function statCard(titulo, dados) {
  return `<div class="card"><div class="kpi">
    <span class="valor">${dados.inscritos}</span>
    <span class="rotulo">${esc(titulo)}</span>
  </div>
  <p class="pagina-sub" style="margin:8px 0 0;font-size:.78rem">${dados.presentes} presente${dados.presentes === 1 ? "" : "s"}</p>
  </div>`;
}

/* ---- ajustar metas ---- */
function modalMetas() {
  const metas = metasAtuais();
  const opcoesIngresso = (sel) => `<option value="">—</option>` +
    tiposIngresso.map((t) => `<option ${t.nome === sel ? "selected" : ""}>${esc(t.nome)}</option>`).join("");
  const blocoNumeros = (titulo, chaveIns, chavePres, vIns, vPres) => `
    <div class="secao" style="border-top:1px solid var(--borda);margin-top:6px;padding-top:14px">
      <h4 style="margin:0 0 10px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">${esc(titulo)}</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Inscritos</span><input class="input" type="number" min="0" name="${chaveIns}" value="${vIns}" /></label>
        <label class="campo"><span>Presentes</span><input class="input" type="number" min="0" name="${chavePres}" value="${vPres}" /></label>
      </div>
    </div>`;

  abrirModal({
    titulo: "Ajustar metas do planejamento",
    textoConfirmar: "Salvar",
    corpoHtml: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Categoria A (ex.: LIFE)</span><select class="select" name="ingresso_a">${opcoesIngresso(metas.ingresso_a)}</select></label>
        <label class="campo"><span>Categoria B (ex.: MASTER)</span><select class="select" name="ingresso_b">${opcoesIngresso(metas.ingresso_b)}</select></label>
      </div>
      ${blocoNumeros("Meta geral", "geral_inscritos", "geral_presentes", metas.geral.inscritos, metas.geral.presentes)}
      ${blocoNumeros("Meta multiplicador (convidados + acompanhantes)", "mult_inscritos", "mult_presentes", metas.multiplicador.inscritos, metas.multiplicador.presentes)}
      ${blocoNumeros("Meta compradores", "comp_inscritos", "comp_presentes", metas.compradores.inscritos, metas.compradores.presentes)}
      <div class="secao" style="border-top:1px solid var(--borda);margin-top:6px;padding-top:14px">
        <h4 style="margin:0 0 10px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">Meta de showrate (%)</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="campo"><span>Convidado / acompanhante</span><input class="input" type="number" min="0" max="100" name="show_convidado" value="${metas.showrate.convidado}" /></label>
          <label class="campo"><span>Comprador</span><input class="input" type="number" min="0" max="100" name="show_comprador" value="${metas.showrate.comprador}" /></label>
        </div>
      </div>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const novo = {
        ingresso_a: f.ingresso_a || "",
        ingresso_b: f.ingresso_b || "",
        geral: { inscritos: Number(f.geral_inscritos) || 0, presentes: Number(f.geral_presentes) || 0 },
        multiplicador: { inscritos: Number(f.mult_inscritos) || 0, presentes: Number(f.mult_presentes) || 0 },
        compradores: { inscritos: Number(f.comp_inscritos) || 0, presentes: Number(f.comp_presentes) || 0 },
        showrate: { convidado: Number(f.show_convidado) || 0, comprador: Number(f.show_comprador) || 0 },
      };
      try {
        evento = await salvarEvento({ metas_planejamento: novo });
        toast("Metas salvas.", "ok");
        render();
      } catch (e) { toast(e.message, "erro"); }
    },
  });
}
