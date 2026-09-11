// =============================================================================
// Painel público do anfitrião — jornada (marcos), convites e ranking.
// Acesso por link com ?a=<slug>. Sem sidebar, sem login.
// =============================================================================
import { esc, slugify, formatarData } from "./ui.js";
import { APP } from "./config.js";
import {
  getAnfitriaoPorSlug, listConvidadosDoAnfitriao, listMarcos, listRankingPublico,
} from "./supabase.js";

const el = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("a");

el("marca").innerHTML = APP.marcaHtml;

const badgeStatus = (s) =>
  ({ Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro");

(async function iniciar() {
  if (!slug) return erro();
  try {
    const anfitriao = await getAnfitriaoPorSlug(slug);
    if (!anfitriao) return erro();

    const [convites, marcos, ranking] = await Promise.all([
      listConvidadosDoAnfitriao(anfitriao.id),
      listMarcos(anfitriao.evento_id).catch(() => []),
      listRankingPublico(anfitriao.evento_id).catch(() => []),
    ]);

    const confirmados = convites.filter((c) => c.status === "Confirmado").length;
    const aprovados = convites.filter((c) => c.status === "Aprovado" || c.status === "Confirmado").length;
    const grupoNome = anfitriao.grupo?.nome;

    el("titulo").textContent = `Olá, ${anfitriao.nome.split(" ")[0]}`;
    el("subtitulo").textContent = grupoNome ? `Tipo ${grupoNome}` : "Seu painel de convites";

    // link de convite
    const base = location.origin;
    const link =
      `${base}${APP.urlConvitePublico}?a=${anfitriao.slug}` +
      `&utm_source=anfitriao&utm_medium=${slugify(anfitriao.nome)}` +
      (grupoNome ? `&utm_campaign=${slugify(grupoNome)}` : "");
    el("btn-link").onclick = () => {
      navigator.clipboard.writeText(link).then(() => {
        el("btn-link").textContent = "Link copiado ✓";
        setTimeout(() => (el("btn-link").textContent = "Copiar meu link de convite"), 2000);
      });
    };

    renderJornada(confirmados, marcos);
    renderConvites(convites, { enviados: convites.length, aprovados, confirmados });
    renderRanking(ranking, anfitriao.id);

    // abas
    el("abas").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        el("abas").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
        b.classList.add("ativo");
        document.querySelectorAll(".pub-secao").forEach((s) =>
          s.classList.toggle("ativa", s.dataset.secao === b.dataset.aba)
        );
      };
    });

    el("carregando").hidden = true;
    el("conteudo").hidden = false;
  } catch (e) {
    console.error(e);
    erro("Não foi possível carregar o painel agora.");
  }
})();

function erro(msg) {
  el("carregando").hidden = true;
  el("conteudo").hidden = true;
  const box = el("erro");
  box.hidden = false;
  if (msg) box.innerHTML = `<h2 style="margin:0 0 8px">Ops</h2><p style="margin:0">${esc(msg)}</p>`;
}

function renderJornada(confirmados, marcosRaw) {
  el("n-confirmados").textContent = confirmados;
  const marcos = [...marcosRaw].sort((a, b) => a.quantidade - b.quantidade);

  if (!marcos.length) {
    el("proximo-marco").textContent = "";
    el("tabuleiro").innerHTML = "";
    el("fases").innerHTML =
      `<p class="pagina-sub" style="margin:14px 0 0">Nenhuma fase configurada ainda.</p>`;
    return;
  }

  const conquistados = marcos.filter((m) => confirmados >= m.quantidade).length;
  const proximo = marcos[conquistados];
  el("proximo-marco").textContent = proximo
    ? `Faltam ${proximo.quantidade - confirmados} confirmados para a bandeira "${proximo.titulo}".`
    : "Você chegou à última bandeira! 🏆";

  desenharTabuleiro(confirmados, marcos, conquistados);
  renderFases(confirmados, marcos, conquistados);
}

/* ---- Tabuleiro (jogo de tabuleiro) ------------------------------------- */
function desenharTabuleiro(confirmados, marcos, conquistados) {
  // nós: início + 1 por marco + meta final
  const N = marcos.length + 2;
  const W = 300;
  const stepY = 124;
  const padY = 44;
  const H = padY * 2 + (N - 1) * stepY;
  const xa = 56, xb = W - 56;
  const X = (i) => (i % 2 === 0 ? xa : xb);
  const Y = (i) => padY + i * stepY;

  let d = `M ${X(0)} ${Y(0)}`;
  for (let i = 1; i < N; i++) {
    const ym = (Y(i - 1) + Y(i)) / 2;
    d += ` C ${X(i - 1)} ${ym}, ${X(i)} ${ym}, ${X(i)} ${Y(i)}`;
  }

  // fração de progresso ao longo do caminho (0 = início, 1 = meta)
  const nodeFrac = (i) => i / (N - 1);
  let progresso;
  if (conquistados >= marcos.length) {
    progresso = 1;
  } else {
    const baixo = conquistados === 0 ? 0 : marcos[conquistados - 1].quantidade;
    const alto = marcos[conquistados].quantidade;
    const seg = alto > baixo ? Math.min(1, Math.max(0, (confirmados - baixo) / (alto - baixo))) : 0;
    progresso = nodeFrac(conquistados) + seg * (nodeFrac(conquistados + 1) - nodeFrac(conquistados));
  }

  const nos = [];
  for (let i = 0; i < N; i++) {
    const cx = X(i), cy = Y(i);
    if (i === 0) {
      nos.push(`<g class="no-inicio"><circle cx="${cx}" cy="${cy}" r="13"/>
        <text x="${cx}" y="${cy + 4}">▶</text></g>
        <text class="rot" x="${cx}" y="${cy - 22}">Início</text>`);
    } else if (i === N - 1) {
      const ok = conquistados >= marcos.length;
      nos.push(`<g class="no-meta ${ok ? "ok" : ""}"><circle cx="${cx}" cy="${cy}" r="18"/>
        <text x="${cx}" y="${cy + 6}" class="emoji">🏆</text></g>
        <text class="rot" x="${cx}" y="${cy + 38}">Meta</text>`);
    } else {
      const m = marcos[i - 1];
      const ok = confirmados >= m.quantidade;
      const atual = !ok && i - 1 === conquistados;
      const cls = ok ? "ok" : atual ? "atual" : "";
      // bandeira "plantada" no marco (mastro + galhardete)
      const bandeira = `<line class="mastro" x1="${cx}" y1="${cy - 4}" x2="${cx}" y2="${cy - 34}"/>
        <polygon class="bandeira" points="${cx},${cy - 34} ${cx + 22},${cy - 28} ${cx},${cy - 21}"/>`;
      nos.push(`<g class="no ${cls}">
        ${bandeira}
        <circle cx="${cx}" cy="${cy}" r="17"/>
        <text x="${cx}" y="${cy + 5}">${ok ? "✓" : m.quantidade}</text>
      </g>`);
    }
  }

  el("tabuleiro").innerHTML = `
    <svg class="tab-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Jornada">
      <path class="via" d="${d}"/>
      <path class="via-feita" d="${d}" pathLength="1" style="stroke-dashoffset:${(1 - progresso).toFixed(4)}"/>
      ${nos.join("")}
      <g class="peao" id="peao"><circle r="12"/><text y="4">📍</text></g>
    </svg>`;

  const via = el("tabuleiro").querySelector(".via");
  const peao = el("tabuleiro").querySelector("#peao");
  const pt = via.getPointAtLength(progresso * via.getTotalLength());
  peao.setAttribute("transform", `translate(${pt.x} ${pt.y - 4})`);
}

/* ---- Fases (cards abaixo do tabuleiro) --------------------------------- */
function renderFases(confirmados, marcos, conquistados) {
  el("fases").innerHTML = marcos
    .map((m, idx) => {
      const ok = confirmados >= m.quantidade;
      const atual = !ok && idx === conquistados;
      const estado = ok ? "conquistada" : atual ? "atual" : "bloqueada";
      const selo = ok
        ? `<span class="fase-selo ok">Bandeira conquistada</span>`
        : atual
        ? `<span class="fase-selo atual">Você está aqui · faltam ${m.quantidade - confirmados}</span>`
        : `<span class="fase-selo bloq">🔒 Bloqueada</span>`;
      const corpo =
        ok || atual
          ? `<p>${esc(m.descricao || "")}</p>`
          : `<p class="dim">Chegue à bandeira anterior para desbloquear.</p>`;
      return `<div class="fase ${estado}">
        <div class="fase-num">${m.quantidade}</div>
        <div class="fase-txt">
          <div class="fase-topo"><h4>${esc(m.titulo)}</h4>${selo}</div>
          ${corpo}
        </div>
      </div>`;
    })
    .join("");
}

function renderConvites(convites, resumo) {
  el("resumo-convites").innerHTML = `
    ${kpi(resumo.enviados, "Enviados")}
    ${kpi(resumo.aprovados, "Aprovados")}
    ${kpi(resumo.confirmados, "Confirmados")}`;
  el("lista-convites").innerHTML = convites.length
    ? convites
        .map(
          (c) => `<div>
            <div><div style="font-weight:600;font-size:.9rem">${esc(c.nome || "—")}</div>
            <div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(c.empresa || "")} · ${formatarData(c.created_at)}</div></div>
            <span class="badge ${badgeStatus(c.status)}">${esc(c.status)}</span>
          </div>`
        )
        .join("")
    : `<p class="pagina-sub" style="margin:0">Você ainda não tem convidados. Compartilhe seu link!</p>`;
}

function kpi(n, rotulo) {
  return `<div class="kpi"><span class="valor">${n}</span><span class="rotulo">${rotulo}</span></div>`;
}

function renderRanking(ranking, meuId) {
  const ordenado = [...ranking].sort((a, b) => b.confirmados - a.confirmados);
  const pos = ordenado.findIndex((r) => r.id === meuId) + 1;
  el("minha-posicao").textContent =
    pos > 0 ? `Você está em ${pos}º de ${ordenado.length} anfitriões.` : "";
  el("lista-ranking").innerHTML = ordenado
    .slice(0, 15)
    .map(
      (r, i) => `<div class="rank-linha ${r.id === meuId ? "eu" : ""}">
        <span><b style="color:var(--texto-suave);margin-right:8px">${i + 1}º</b>${esc(r.nome)}</span>
        <span style="font-weight:700">${r.confirmados}</span>
      </div>`
    )
    .join("");
}
