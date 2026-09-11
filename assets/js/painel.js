// =============================================================================
// Painel público do anfitrião — jornada (marcos), convites e ranking.
// Acesso por link com ?a=<slug>. Sem sidebar, sem login.
// =============================================================================
import { esc, slugify, formatarData } from "./ui.js";
import { APP } from "./config.js";
import {
  getAnfitriaoPorSlug, listConvidadosDoAnfitriao, listMarcos, listRankingPublico, getEvento,
} from "./supabase.js";

const el = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("a");

el("marca").innerHTML = APP.marcaHtml;

// status do CONVITE (aprovação pelo anfitrião/organização)
const badgeStatus = (s) =>
  ({ Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro");
// Situação do PARTICIPANTE gerado a partir do convite (campo separado)
const badgeSituacao = (s) =>
  ({ Confirmado: "badge-ok", Pendente: "badge-alerta", "Fila de espera": "badge-info",
     "Pré-inscrito": "badge-neutro", Desativado: "badge-erro" }[s] || "badge-neutro");
const situacaoDoParticipante = (c) =>
  (Array.isArray(c.participante) ? c.participante[0]?.situacao : c.participante?.situacao) || null;

(async function iniciar() {
  if (!slug) return erro();
  try {
    const anfitriao = await getAnfitriaoPorSlug(slug);
    if (!anfitriao) return erro();

    const [convites, marcosRaw, ranking, evento] = await Promise.all([
      listConvidadosDoAnfitriao(anfitriao.id),
      listMarcos(anfitriao.evento_id).catch(() => []),
      listRankingPublico(anfitriao.evento_id).catch(() => []),
      getEvento(anfitriao.evento_id).catch(() => null),
    ]);
    // o marco "prêmio final" acompanha a Meta de confirmados do evento, mesmo
    // que ela mude depois de o marco ter sido criado
    const metaEvento = Number(evento?.meta_confirmados) || 0;
    const marcos = marcosRaw.map((m) => (m.meta_final && metaEvento ? { ...m, quantidade: metaEvento } : m));

    // "Confirmados" aqui é a Situação do participante gerado pelo convite
    // (Confirmado/Pendente/Fila de espera/Pré-inscrito/Desativado) — um campo
    // separado do status do convite em si (Pendente/Aprovado/Recusado).
    const confirmados = convites.filter((c) => situacaoDoParticipante(c) === "Confirmado").length;
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

    // a jornada avança por convidado aprovado (não só "Confirmado" — esse
    // status costuma vir bem depois, no dia do evento)
    renderJornada(aprovados, marcos, anfitriao.id);
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

function renderJornada(aprovados, marcosTodos, anfitriaoId) {
  el("n-confirmados").textContent = aprovados;
  // o marco "prêmio final" não é mais uma bandeira no meio do caminho — ele
  // vira o próprio troféu no fim do tabuleiro/lista.
  const marcoFinal = marcosTodos.find((m) => m.meta_final) || null;
  const marcos = marcosTodos.filter((m) => !m.meta_final).sort((a, b) => a.quantidade - b.quantidade);

  if (!marcos.length && !marcoFinal) {
    el("proximo-marco").textContent = "";
    el("tabuleiro").innerHTML = "";
    el("fases").innerHTML =
      `<p class="pagina-sub" style="margin:14px 0 0">Nenhuma fase configurada ainda.</p>`;
    return;
  }

  const conquistados = marcos.filter((m) => aprovados >= m.quantidade).length;
  const alvo = conquistados < marcos.length ? marcos[conquistados] : marcoFinal;
  el("proximo-marco").textContent = alvo && aprovados < alvo.quantidade
    ? `Faltam ${alvo.quantidade - aprovados} convidados aprovados para desbloquear a próxima bandeira!`
    : "Você chegou à última bandeira! 🏆";

  desenharTabuleiro(aprovados, marcos, conquistados, marcoFinal);
  renderFases(aprovados, marcos, conquistados, marcoFinal);
  celebrarNovasConquistas(aprovados, marcos, marcoFinal, anfitriaoId);
}

/* ---- Celebração ao desbloquear uma bandeira ---------------------------- */
function celebrarNovasConquistas(aprovados, marcos, marcoFinal, anfitriaoId) {
  const todos = marcoFinal ? [...marcos, marcoFinal] : marcos;
  const conquistadosAgora = todos.filter((m) => aprovados >= m.quantidade);
  if (!conquistadosAgora.length) return;

  const chave = `we_marcos_celebrados_${anfitriaoId}`;
  let jaCelebrados;
  try { jaCelebrados = new Set(JSON.parse(localStorage.getItem(chave) || "[]")); } catch { jaCelebrados = new Set(); }

  const novos = conquistadosAgora.filter((m) => !jaCelebrados.has(m.id));
  conquistadosAgora.forEach((m) => jaCelebrados.add(m.id));
  try { localStorage.setItem(chave, JSON.stringify([...jaCelebrados])); } catch {}
  if (!novos.length) return;

  // celebra a maior conquista nova (se ele confirmou vários de uma vez e
  // passou por mais de uma bandeira, só mostra a mais recente)
  const premio = novos.sort((a, b) => b.quantidade - a.quantidade)[0];
  mostrarCelebracao(premio, premio === marcoFinal);
}

let _confettiPromise = null;
async function dispararConfete() {
  try {
    if (!_confettiPromise) _confettiPromise = import("https://esm.sh/canvas-confetti@1.9.2");
    const { default: confetti } = await _confettiPromise;
    const fim = Date.now() + 2200;
    (function disparo() {
      confetti({ particleCount: 4, startVelocity: 45, spread: 75, ticks: 200, origin: { x: Math.random(), y: -0.1 } });
      if (Date.now() < fim) requestAnimationFrame(disparo);
    })();
    confetti({ particleCount: 140, spread: 100, startVelocity: 45, origin: { y: 0.55 } });
  } catch (e) {
    console.warn("confete indisponível", e);
  }
}

function mostrarCelebracao(marco, ehPremioFinal) {
  dispararConfete();
  const overlay = document.createElement("div");
  overlay.className = "celebracao-overlay";
  overlay.innerHTML = `
    <div class="celebracao-card">
      <div class="celebracao-emoji">${ehPremioFinal ? "🏆" : "🎉"}</div>
      <h2>${ehPremioFinal ? "Meta conquistada!" : "Bandeira conquistada!"}</h2>
      <p class="celebracao-premio">${esc(marco.titulo)}</p>
      ${marco.descricao ? `<p class="celebracao-desc">${esc(marco.descricao)}</p>` : ""}
      <button class="btn btn-primario" id="celebracao-fechar">Continuar</button>
    </div>`;
  document.body.appendChild(overlay);
  const fechar = () => overlay.remove();
  overlay.querySelector("#celebracao-fechar").onclick = fechar;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) fechar(); });
}

/* ---- Tabuleiro (jogo de tabuleiro) ------------------------------------- */
function desenharTabuleiro(aprovados, marcos, conquistados, marcoFinal) {
  // nós: início + 1 por marco (sem contar o prêmio final) + a meta no fim
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
  if (conquistados < marcos.length) {
    const baixo = conquistados === 0 ? 0 : marcos[conquistados - 1].quantidade;
    const alto = marcos[conquistados].quantidade;
    const seg = alto > baixo ? Math.min(1, Math.max(0, (aprovados - baixo) / (alto - baixo))) : 0;
    progresso = nodeFrac(conquistados) + seg * (nodeFrac(conquistados + 1) - nodeFrac(conquistados));
  } else if (marcoFinal) {
    // último trecho: do último marco normal até a meta final
    const baixo = marcos.length ? marcos[marcos.length - 1].quantidade : 0;
    const alto = marcoFinal.quantidade;
    const seg = alto > baixo ? Math.min(1, Math.max(0, (aprovados - baixo) / (alto - baixo))) : 1;
    progresso = nodeFrac(marcos.length) + seg * (nodeFrac(marcos.length + 1) - nodeFrac(marcos.length));
  } else {
    progresso = 1;
  }

  const nos = [];
  for (let i = 0; i < N; i++) {
    const cx = X(i), cy = Y(i);
    if (i === 0) {
      nos.push(`<g class="no-inicio"><circle cx="${cx}" cy="${cy}" r="13"/>
        <text x="${cx}" y="${cy + 4}">▶</text></g>
        <text class="rot" x="${cx}" y="${cy - 22}">Início</text>`);
    } else if (i === N - 1) {
      // o troféu final É o prêmio final (quando configurado) — o nome só
      // aparece depois de conquistado, senão vira "Meta" genérico
      const ok = marcoFinal ? aprovados >= marcoFinal.quantidade : conquistados >= marcos.length;
      const rotulo = ok && marcoFinal ? esc(marcoFinal.titulo) : "Meta";
      nos.push(`<g class="no-meta ${ok ? "ok" : ""}"><circle cx="${cx}" cy="${cy}" r="18"/>
        <text x="${cx}" y="${cy + 6}" class="emoji">🏆</text></g>
        <text class="rot" x="${cx}" y="${cy + 38}">${rotulo}</text>`);
    } else {
      const m = marcos[i - 1];
      const ok = aprovados >= m.quantidade;
      // sem destaque "atual" na bandeira em si — quem marca a posição do
      // anfitrião é só o peão (📍), senão parece que ele já chegou lá
      const cls = ok ? "ok" : "";
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
function renderFases(aprovados, marcos, conquistados, marcoFinal) {
  const cards = marcos.map((m, idx) => {
    const ok = aprovados >= m.quantidade;
    // "próxima" é só pra mostrar "faltam X" — visualmente ela fica igual às
    // outras bandeiras não alcançadas (cinza); só o marcador "você está aqui"
    // é destacado.
    const proxima = !ok && idx === conquistados;
    const estado = ok ? "conquistada" : "bloqueada";
    const selo = ok
      ? `<span class="fase-selo ok">Bandeira conquistada</span>`
      : proxima
      ? `<span class="fase-selo bloq">🔒 Próxima meta · faltam ${m.quantidade - aprovados}</span>`
      : `<span class="fase-selo bloq">🔒 Bloqueada</span>`;
    // o prêmio só é revelado (título + descrição) depois de conquistado —
    // antes disso é surpresa, mesmo na bandeira mais próxima
    const titulo = ok ? esc(m.titulo) : "🔒 Prêmio bloqueado";
    const corpo = ok
      ? `<p>${esc(m.descricao || "")}</p>`
      : proxima
      ? `<p class="dim">Continue aprovando convidados para descobrir o prêmio!</p>`
      : `<p class="dim">Chegue à bandeira anterior para desbloquear.</p>`;
    return `<div class="fase ${estado}">
      <div class="fase-num">${m.quantidade}</div>
      <div class="fase-txt">
        <div class="fase-topo"><h4>${titulo}</h4>${selo}</div>
        ${corpo}
      </div>
    </div>`;
  });

  // marcador "você está aqui": posição real do anfitrião — entra antes da
  // próxima bandeira (ou no fim da lista, se já conquistou todas). Fica
  // separado das bandeiras pra não parecer que ele já chegou numa delas.
  const posAtual = `<div class="fase atual fase-aqui">
    <div class="fase-num">📍</div>
    <div class="fase-txt">
      <div class="fase-topo"><h4>Você está aqui</h4></div>
      <p>${aprovados} convidado${aprovados === 1 ? "" : "s"} aprovado${aprovados === 1 ? "" : "s"} até agora.</p>
    </div>
  </div>`;
  cards.splice(conquistados, 0, posAtual);

  // o prêmio final vira o card de encerramento (troféu), não mais uma
  // bandeira numerada no meio da lista
  if (marcoFinal) {
    const ok = aprovados >= marcoFinal.quantidade;
    const titulo = ok ? esc(marcoFinal.titulo) : "🔒 Prêmio final bloqueado";
    // esconde o NOME do prêmio até conquistar, mas o número da Meta (quantos
    // aprovados faltam) sempre aparece — senão ninguém sabe a meta a bater
    const selo = ok
      ? `<span class="fase-selo ok">Meta conquistada</span>`
      : `<span class="fase-selo bloq">🔒 Meta do evento · faltam ${marcoFinal.quantidade - aprovados}</span>`;
    const corpo = ok
      ? `<p>${esc(marcoFinal.descricao || "")}</p>`
      : `<p class="dim">Alcance ${marcoFinal.quantidade} convidados aprovados para descobrir o grande prêmio!</p>`;
    cards.push(`<div class="fase ${ok ? "conquistada" : "bloqueada"}">
      <div class="fase-num">🏆</div>
      <div class="fase-txt">
        <div class="fase-topo"><h4>${titulo}</h4>${selo}</div>
        ${corpo}
      </div>
    </div>`);
  }

  el("fases").innerHTML = cards.join("");
}

function renderConvites(convites, resumo) {
  el("resumo-convites").innerHTML = `
    ${kpi(resumo.enviados, "Enviados")}
    ${kpi(resumo.aprovados, "Aprovados")}
    ${kpi(resumo.confirmados, "Confirmados")}`;
  el("lista-convites").innerHTML = convites.length
    ? convites
        .map((c) => {
          const situacao = situacaoDoParticipante(c);
          return `<div>
            <div><div style="font-weight:600;font-size:.9rem">${esc(c.nome || "—")}</div>
            <div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(c.empresa || "")} · ${formatarData(c.created_at)}</div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              <span class="badge ${badgeStatus(c.status)}" title="Status do convite">${esc(c.status)}</span>
              ${situacao ? `<span class="badge ${badgeSituacao(situacao)}" title="Situação">${esc(situacao)}</span>` : ""}
            </div>
          </div>`;
        })
        .join("")
    : `<p class="pagina-sub" style="margin:0">Você ainda não tem convidados. Compartilhe seu link!</p>`;
}

function kpi(n, rotulo) {
  return `<div class="kpi"><span class="valor">${n}</span><span class="rotulo">${rotulo}</span></div>`;
}

function renderRanking(ranking, meuId) {
  // ordem decrescente por indicações aprovadas (Aprovado + Confirmado)
  const ordenado = [...ranking].sort((a, b) => b.aprovados - a.aprovados);
  const pos = ordenado.findIndex((r) => r.id === meuId) + 1;
  el("minha-posicao").textContent =
    pos > 0 ? `Você está em ${pos}º de ${ordenado.length} anfitriões.` : "";
  el("lista-ranking").innerHTML = ordenado
    .slice(0, 15)
    .map(
      (r, i) => `<div class="rank-linha ${r.id === meuId ? "eu" : ""}">
        <span><b style="color:var(--texto-suave);margin-right:8px">${i + 1}º</b>${esc(r.nome)}</span>
        <span style="font-weight:700">${r.aprovados}</span>
      </div>`
    )
    .join("");
}
