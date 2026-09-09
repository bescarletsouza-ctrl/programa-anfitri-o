// =============================================================================
// Painel público do anfitrião — jornada (marcos), convites e ranking.
// Acesso por link com ?a=<slug>. Sem sidebar, sem login.
// =============================================================================
import { esc, slugify, formatarData } from "./ui.js";
import { APP } from "./config.js";
import {
  getAnfitriaoPorSlug, listConvidadosDoAnfitriao, listMarcos,
  listRankingPublico, listGrupos,
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

    const [convites, marcos, ranking, grupos] = await Promise.all([
      listConvidadosDoAnfitriao(anfitriao.id),
      listMarcos().catch(() => []),
      listRankingPublico().catch(() => []),
      listGrupos().catch(() => []),
    ]);

    const confirmados = convites.filter((c) => c.status === "Confirmado").length;
    const aprovados = convites.filter((c) => c.status === "Aprovado" || c.status === "Confirmado").length;
    const grupoNome = grupos.find((g) => g.id === anfitriao.grupo_id)?.nome;

    el("titulo").textContent = `Olá, ${anfitriao.nome.split(" ")[0]}`;
    el("subtitulo").textContent = grupoNome ? `Grupo ${grupoNome}` : "Seu painel de convites";

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

function renderJornada(confirmados, marcos) {
  el("n-confirmados").textContent = confirmados;
  const proximo = marcos.find((m) => confirmados < m.quantidade);
  el("proximo-marco").textContent = proximo
    ? `Faltam ${proximo.quantidade - confirmados} para "${proximo.titulo}".`
    : marcos.length
    ? "Todos os marcos desbloqueados! 🎉"
    : "";

  el("trilha").innerHTML = marcos.length
    ? marcos
        .map((m) => {
          const ok = confirmados >= m.quantidade;
          const bloq = !ok;
          const faltam = bloq ? `<div class="faltam">faltam ${m.quantidade - confirmados}</div>` : "";
          return `<div class="marco ${ok ? "ok" : "bloqueado"}">
            <div class="bolha">${ok ? "✓" : m.quantidade}</div>
            <div class="conteudo">
              <h4>${esc(m.titulo)}</h4>
              <p>${esc(m.descricao || "")}</p>
              ${faltam}
            </div>
          </div>`;
        })
        .join("")
    : `<p class="pagina-sub" style="margin:14px 0 0">Nenhum marco configurado ainda.</p>`;
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
