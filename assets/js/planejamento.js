// =============================================================================
// Planejamento — metas de inscritos/confirmados/presentes/não vai (geral,
// multiplicador, compradores) e a quebra por Tipo × categoria de
// ingresso (ex.: LIFE / MASTER). Multiplicador = quem indica/multiplica
// (Anfitrião, Convidado, Acompanhante) — Comprador fica de fora, é quem
// comprou direto.
// Metas ficam em eventos.metas_planejamento (jsonb), editáveis em "Ajustar
// metas". Contagens são sempre calculadas ao vivo a partir de listParticipantes().
// =============================================================================
import { iniciarPagina, esc, abrirModal, toast } from "./ui.js";
import { listParticipantes, listTiposIngresso, getEvento, salvarEvento } from "./supabase.js";
import { eventoId } from "./evento.js";

const _iniciando = iniciarPagina("planejamento");
const el = (id) => document.getElementById(id);

let participantes = [];
let tiposIngresso = [];
let evento = null;

const GRUPO_PADRAO = { inscritos: 0, confirmados: 0, presentes: 0, naoVai: 0 };
const METAS_PADRAO = {
  ingresso_a: "", ingresso_b: "",
  geral: { ...GRUPO_PADRAO },
  multiplicador: { ...GRUPO_PADRAO },
  compradores: { ...GRUPO_PADRAO },
  mentorados: { ...GRUPO_PADRAO },
};
const metasAtuais = () => {
  const salvo = evento?.metas_planejamento || {};
  return {
    ...METAS_PADRAO, ...salvo,
    geral: { ...GRUPO_PADRAO, ...(salvo.geral || {}) },
    multiplicador: { ...GRUPO_PADRAO, ...(salvo.multiplicador || {}) },
    compradores: { ...GRUPO_PADRAO, ...(salvo.compradores || {}) },
    mentorados: { ...GRUPO_PADRAO, ...(salvo.mentorados || {}) },
  };
};

// tipos que "multiplicam" o evento (indicam/trazem gente) — Comprador fica
// de fora porque comprou direto, não veio por indicação.
const TIPOS_MULTIPLICADOR = ["Anfitrião", "Convidado", "Acompanhante"];

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
const catDe = (p) => (p.ingresso || "").trim();

// tipos: array de p.tipo aceitos (null = qualquer); cat: categoria de ingresso
// exigida (null = qualquer; "" = categoria ainda não configurada → zera).
function grupo(tipos, cat) {
  if (cat === "") return { ...GRUPO_PADRAO };
  const alvo = participantes.filter((p) => {
    if (tipos && !tipos.includes(p.tipo)) return false;
    if (cat != null && catDe(p) !== cat) return false;
    return true;
  });
  return {
    inscritos: alvo.length,
    confirmados: alvo.filter((p) => (p.situacao || "Confirmado") === "Confirmado").length,
    presentes: alvo.filter((p) => p.presente).length,
    naoVai: alvo.filter((p) => p.situacao === "Desativado").length,
  };
}

function render() {
  const metas = metasAtuais();
  const A = metas.ingresso_a, B = metas.ingresso_b;

  const geral = grupo(null, null);
  const multiplicador = grupo(TIPOS_MULTIPLICADOR, null);
  const compradores = grupo(["Comprador"], null);
  const mentorados = grupo(["Mentorado"], null);

  el("metas-principais").innerHTML = [
    cardMeta("Meta geral", geral, metas.geral),
    cardMeta(`Multiplicador${A || B ? ` (${[A, B].filter(Boolean).join(" + ")})` : ""}`, multiplicador, metas.multiplicador),
    cardMeta("Compradores", compradores, metas.compradores),
    cardMeta("Mentorados", mentorados, metas.mentorados),
  ].join("");

  el("quebra-aviso").hidden = !!(A && B);
  el("quebra-categorias").innerHTML = (A || B) ? [
    statCard(`Anfitrião ${A || "A"}`, grupo(["Anfitrião"], A)),
    statCard(`Anfitrião ${B || "B"}`, grupo(["Anfitrião"], B)),
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
    ${barraHtml("Confirmados", atual.confirmados, alvo.confirmados)}
    ${barraHtml("Presentes", atual.presentes, alvo.presentes)}
    ${barraHtml("Não vai", atual.naoVai, alvo.naoVai)}
  </div>`;
}

function statCard(titulo, dados) {
  return `<div class="card"><div class="kpi">
    <span class="valor">${dados.inscritos}</span>
    <span class="rotulo">${esc(titulo)}</span>
  </div>
  <p class="pagina-sub" style="margin:8px 0 0;font-size:.78rem">${dados.confirmados} confirmado${dados.confirmados === 1 ? "" : "s"} · ${dados.presentes} presente${dados.presentes === 1 ? "" : "s"} · ${dados.naoVai} não vai</p>
  </div>`;
}

/* ---- ajustar metas ---- */
function modalMetas() {
  const metas = metasAtuais();
  const opcoesIngresso = (sel) => `<option value="">—</option>` +
    tiposIngresso.map((t) => `<option ${t.nome === sel ? "selected" : ""}>${esc(t.nome)}</option>`).join("");
  const blocoNumeros = (titulo, prefixo, g) => `
    <div class="secao" style="border-top:1px solid var(--borda);margin-top:6px;padding-top:14px">
      <h4 style="margin:0 0 10px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-tenue)">${esc(titulo)}</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Inscritos</span><input class="input" type="number" min="0" name="${prefixo}_inscritos" value="${g.inscritos}" /></label>
        <label class="campo"><span>Confirmados</span><input class="input" type="number" min="0" name="${prefixo}_confirmados" value="${g.confirmados}" /></label>
        <label class="campo"><span>Presentes</span><input class="input" type="number" min="0" name="${prefixo}_presentes" value="${g.presentes}" /></label>
        <label class="campo"><span>Não vai</span><input class="input" type="number" min="0" name="${prefixo}_naoVai" value="${g.naoVai}" /></label>
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
      ${blocoNumeros("Meta geral", "geral", metas.geral)}
      ${blocoNumeros("Meta multiplicador (anfitrião + convidados + acompanhantes)", "mult", metas.multiplicador)}
      ${blocoNumeros("Meta compradores", "comp", metas.compradores)}
      ${blocoNumeros("Meta mentorados", "ment", metas.mentorados)}`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const ler = (p) => ({
        inscritos: Number(f[`${p}_inscritos`]) || 0,
        confirmados: Number(f[`${p}_confirmados`]) || 0,
        presentes: Number(f[`${p}_presentes`]) || 0,
        naoVai: Number(f[`${p}_naoVai`]) || 0,
      });
      const novo = {
        ingresso_a: f.ingresso_a || "",
        ingresso_b: f.ingresso_b || "",
        geral: ler("geral"),
        multiplicador: ler("mult"),
        compradores: ler("comp"),
        mentorados: ler("ment"),
      };
      try {
        evento = await salvarEvento({ metas_planejamento: novo });
        toast("Metas salvas.", "ok");
        render();
      } catch (e) { toast(e.message, "erro"); }
    },
  });
}
