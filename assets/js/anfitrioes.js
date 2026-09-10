// =============================================================================
// Gestão de anfitriões — tabela, filtros, modal "novo", gaveta de detalhe.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, slugify, telParaWhatsApp,
  abrirModal, abrirGaveta, fecharGaveta, toast, confirmar, icone,
} from "./ui.js";
import {
  listEstagios, listGrupos, listResponsaveis, listAnfitrioes,
  listConvidadosDoAnfitriao, salvar, remover, inserirLote, reSincCategoriaAnfitriao,
  sincAnfitriaoParticipante, desvincularAoExcluirAnfitriao,
} from "./supabase.js";
import { APP, TIPOS_ANFITRIAO } from "./config.js";
import { parsearTabela } from "./tabela.js";

iniciarPagina("anfitrioes");
const el = (id) => document.getElementById(id);

let estagios = [], grupos = [], responsaveis = [], lista = [];
let aba = "todos";
const filtros = { busca: "", grupo: "", estagio: "", presenca: "" };

carregar();

async function carregar() {
  try {
    [estagios, grupos, responsaveis, lista] = await Promise.all([
      listEstagios(), listGrupos(), listResponsaveis(), listAnfitrioes(),
    ]);
    preencherSelect(el("f-grupo"), grupos, "Todos os grupos");
    preencherSelect(el("f-estagio"), estagios, "Todos os estágios");
    el("carregando").hidden = true;
    render();
  } catch (e) {
    el("carregando").textContent = "Erro ao carregar: " + e.message;
  }
}

function preencherSelect(sel, arr, placeholder, valorAtual) {
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    arr.map((x) => `<option value="${x.id}" ${x.id === valorAtual ? "selected" : ""}>${esc(x.nome)}</option>`).join("");
}

/* ---- filtros ---- */
el("busca").addEventListener("input", debounce((e) => { filtros.busca = e.target.value.toLowerCase(); render(); }, 200));
["f-grupo", "f-estagio", "f-presenca"].forEach((id) => {
  el(id).addEventListener("change", (e) => {
    filtros[id.replace("f-", "")] = e.target.value;
    render();
  });
});
el("abas").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    el("abas").querySelectorAll("button").forEach((x) => x.classList.remove("ativo"));
    b.classList.add("ativo");
    aba = b.dataset.aba;
    render();
  };
});
el("btn-novo").innerHTML = icone("mais") + "Novo anfitrião";
el("btn-novo").onclick = modalNovo;
el("btn-importar").innerHTML = icone("subir") + "Importar lista";
el("btn-importar").onclick = modalImportar;

/* ---- render ---- */
function filtrar() {
  return lista.filter((a) => {
    if (aba === "ativos" && a.vai === false) return false;
    if (aba === "nao" && a.vai !== false) return false;
    // aba "todos": sem filtro por "vai"
    if (filtros.grupo && a.grupo_id !== filtros.grupo) return false;
    if (filtros.estagio && a.estagio_id !== filtros.estagio) return false;
    if (filtros.presenca === "sim" && !a.presenca) return false;
    if (filtros.presenca === "nao" && a.presenca) return false;
    if (filtros.busca) {
      const alvo = (a.nome + " " + (a.email || "")).toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

function nomeGrupo(id) { return grupos.find((g) => g.id === id)?.nome; }
function nomeEstagio(id) { return estagios.find((s) => s.id === id)?.nome || "—"; }
function nomeResp(id) { return responsaveis.find((r) => r.id === id)?.nome || "—"; }

function render() {
  const filtrada = filtrar();
  el("contador").textContent = `Exibindo ${filtrada.length} de ${lista.length} anfitriões`;
  const vazio = filtrada.length === 0;
  el("wrap").hidden = vazio;
  el("vazio").hidden = !vazio;
  if (vazio) return;

  el("linhas").innerHTML = filtrada
    .map((a) => {
      const g = nomeGrupo(a.grupo_id);
      return `<tr data-id="${a.id}">
        <td><strong>${esc(a.nome)}</strong><div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(a.tipo || "")}</div></td>
        <td>${g ? `<span class="badge badge-laranja">${esc(g)}</span>` : "—"}</td>
        <td>${esc(a.email || "—")}</td>
        <td>${esc(a.telefone || "—")}</td>
        <td>${a.presenca ? '<span class="badge badge-ok">Sim</span>' : '<span class="badge badge-neutro">Não</span>'}</td>
        <td>${a.enviados || 0}</td>
        <td>${a.aprovados || 0}</td>
        <td class="linha-acoes">
          <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
          <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
        </td>
      </tr>`;
    })
    .join("");

  el("linhas").querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.onclick = (e) => {
      if (e.target.closest("[data-excluir]")) return excluir(id);
      if (e.target.closest("[data-editar]")) return abrirGavetaDetalhe(id);
      abrirGavetaDetalhe(id);
    };
  });
}

const categoriasUsadas = () =>
  [...new Set(lista.map((a) => (a.categoria_convidado || "").trim()).filter(Boolean))].sort();

/* ---- Novo anfitrião ---- */
function modalNovo() {
  abrirModal({
    titulo: "Novo anfitrião",
    textoConfirmar: "Criar",
    corpoHtml: `
      <label class="campo"><span>Tipo</span>
        <select class="select" name="tipo">${TIPOS_ANFITRIAO.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label class="campo"><span>Nome completo *</span><input class="input" name="nome" required /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" /></label>
      <label class="campo"><span>Grupo</span>
        <select class="select" name="grupo_id"><option value="">—</option>
          ${grupos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Categoria liberada para os convidados dele</span>
        <input class="input" name="categoria_convidado" list="cats-anf" placeholder="Ex.: VIP, GOLD…" />
        <datalist id="cats-anf">${categoriasUsadas().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="campo"><span>Responsável</span>
        <select class="select" name="responsavel_id"><option value="">—</option>
          ${responsaveis.map((r) => `<option value="${r.id}">${esc(r.nome)}</option>`).join("")}</select></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const novo = await salvar("anfitrioes", {
        tipo: f.tipo, nome: f.nome.trim(), email: f.email || null, telefone: f.telefone || null,
        grupo_id: f.grupo_id || null, responsavel_id: f.responsavel_id || null,
        categoria_convidado: f.categoria_convidado.trim() || null,
        estagio_id: estagios[0]?.id || null,
      });
      await sincAnfitriaoParticipante(novo).catch((e) => console.warn(e));
      toast("Anfitrião criado.", "ok");
      lista = await listAnfitrioes();
      render();
      abrirGavetaDetalhe(novo.id);
    },
  });
}

/* ---- Importar lista ---- */
const MODELO_CSV =
  "nome,email,telefone,tipo,grupo,responsavel\n" +
  "Maria Silva,maria@exemplo.com,11999990000,Titular,Turma 1,Ana\n" +
  "João Souza,joao@exemplo.com,11988887777,Titular,Turma 1,Ana";

const ALIAS = {
  "nome completo": "nome", "e-mail": "email",
  whatsapp: "telefone", celular: "telefone", fone: "telefone",
  turma: "grupo",
  "responsavel (cs)": "responsavel", cs: "responsavel",
};

function modalImportar() {
  abrirModal({
    titulo: "Importar lista de anfitriões",
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole uma tabela (do Excel/Sheets) ou selecione um arquivo CSV. Colunas
        aceitas: <b>nome</b> (obrigatória), email, telefone, tipo, grupo, responsavel.
        Grupo e responsável são criados automaticamente se ainda não existirem.
      </p>
      <a href="data:text/csv;charset=utf-8,${encodeURIComponent(MODELO_CSV)}" download="modelo-anfitrioes.csv"
         style="font-size:.8rem;font-weight:600;color:var(--cor-laranja-forte)">↓ baixar modelo CSV</a>
      <label class="campo" style="margin-top:12px"><span>Colar tabela</span>
        <textarea class="input" name="texto" rows="7" placeholder="nome,email,telefone,tipo,grupo,responsavel&#10;Maria Silva,maria@exemplo.com,..."></textarea></label>
      <label class="campo"><span>…ou arquivo CSV</span>
        <input class="input" type="file" name="arquivo" accept=".csv,.txt,.tsv" /></label>
      <div class="pagina-sub" id="imp-status" style="margin:0"></div>`,
    aoMontar: (root) => {
      const arq = root.querySelector('[name="arquivo"]');
      const txt = root.querySelector('[name="texto"]');
      arq.onchange = () => {
        const f = arq.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { txt.value = r.result; };
        r.readAsText(f, "utf-8");
      };
    },
    onConfirmar: async (form) => {
      const texto = form.querySelector('[name="texto"]').value;
      const linhas = parsearTabela(texto, ALIAS);
      const validas = linhas.filter((l) => (l.nome || "").trim());
      if (!validas.length) {
        toast("Nenhuma linha com nome encontrada. Confira o cabeçalho.", "erro");
        return false;
      }

      // resolve/cria grupos e responsáveis por nome
      const mapaGrupo = new Map(grupos.map((g) => [g.nome.toLowerCase(), g.id]));
      const mapaResp = new Map(responsaveis.map((r) => [r.nome.toLowerCase(), r.id]));
      let criouAux = false;

      for (const l of validas) {
        if (l.grupo && !mapaGrupo.has(l.grupo.toLowerCase())) {
          const g = await salvar("grupos", { nome: l.grupo.trim() });
          mapaGrupo.set(g.nome.toLowerCase(), g.id);
          criouAux = true;
        }
        if (l.responsavel && !mapaResp.has(l.responsavel.toLowerCase())) {
          const r = await salvar("responsaveis", { nome: l.responsavel.trim() });
          mapaResp.set(r.nome.toLowerCase(), r.id);
          criouAux = true;
        }
      }

      const registros = validas.map((l) => ({
        nome: l.nome.trim(),
        email: (l.email || "").trim() || null,
        telefone: (l.telefone || "").trim() || null,
        tipo: TIPOS_ANFITRIAO.includes((l.tipo || "").trim()) ? l.tipo.trim() : "Titular",
        grupo_id: l.grupo ? mapaGrupo.get(l.grupo.toLowerCase()) || null : null,
        responsavel_id: l.responsavel ? mapaResp.get(l.responsavel.toLowerCase()) || null : null,
        estagio_id: estagios[0]?.id || null,
      }));

      const criados = await inserirLote("anfitrioes", registros);
      // anfitrião que "vai ao evento" (padrão) também entra em Participantes
      for (const novo of criados.filter((a) => a.vai !== false)) {
        await sincAnfitriaoParticipante(novo).catch((e) => console.warn(e));
      }
      const ignoradas = linhas.length - validas.length;
      toast(
        `${registros.length} anfitrião(ões) importado(s).` +
          (ignoradas ? ` ${ignoradas} linha(s) sem nome ignorada(s).` : ""),
        "ok"
      );
      if (criouAux) [grupos, responsaveis] = await Promise.all([listGrupos(), listResponsaveis()]);
      preencherSelect(el("f-grupo"), grupos, "Todos os grupos", filtros.grupo);
      lista = await listAnfitrioes();
      render();
    },
  });
}

/* ---- Gaveta de detalhe ---- */
async function abrirGavetaDetalhe(id) {
  const a = lista.find((x) => x.id === id);
  if (!a) return;
  const convidados = await listConvidadosDoAnfitriao(id).catch(() => []);
  const base = location.origin + location.pathname.replace(/\/admin\/.*/, "");
  const linkConvite = `${base}${APP.urlConvitePublico}?a=${a.slug}` +
    `&utm_source=anfitriao&utm_medium=${slugify(a.nome)}` +
    (a.grupo_id ? `&utm_campaign=${slugify(nomeGrupo(a.grupo_id) || "")}` : "");
  const linkPainel = `${base}${APP.urlPainelAnfitriao}?a=${a.slug}`;

  abrirGaveta(
    `${esc(a.nome)}`,
    `
    <div class="secao">
      <span class="badge badge-laranja">${esc(nomeEstagio(a.estagio_id))}</span>
      ${a.grupo_id ? `<span class="badge badge-neutro">${esc(nomeGrupo(a.grupo_id))}</span>` : ""}
      ${a.participante_id ? `<span class="badge badge-info" title="Sincronizado pela chave e-mail">Também em Participantes</span>` : ""}
      <span class="badge badge-neutro">Criado em ${formatarData(a.created_at)}</span>
    </div>

    <div class="secao">
      <h4>Contato</h4>
      <label class="campo"><span>E-mail</span><input class="input" id="d-email" value="${esc(a.email || "")}" /></label>
      <label class="campo"><span>Telefone</span><input class="input" id="d-telefone" value="${esc(a.telefone || "")}" /></label>
      ${telParaWhatsApp(a.telefone) ? `<a class="btn btn-secundario" href="${telParaWhatsApp(a.telefone)}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ""}
    </div>

    <div class="secao">
      <h4>Gestão</h4>
      <label class="campo"><span>Responsável</span>
        <select class="select" id="d-resp"><option value="">—</option>
          ${responsaveis.map((r) => `<option value="${r.id}" ${r.id === a.responsavel_id ? "selected" : ""}>${esc(r.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Grupo</span>
        <select class="select" id="d-grupo"><option value="">—</option>
          ${grupos.map((g) => `<option value="${g.id}" ${g.id === a.grupo_id ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Categoria liberada para os convidados dele</span>
        <input class="input" id="d-categoria-convidado" list="cats-anf" value="${esc(a.categoria_convidado || "")}" placeholder="Ex.: VIP, GOLD…" />
        <datalist id="cats-anf">${categoriasUsadas().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="campo"><span>Estágio do funil</span>
        <select class="select" id="d-estagio"><option value="">—</option>
          ${estagios.map((s) => `<option value="${s.id}" ${s.id === a.estagio_id ? "selected" : ""}>${esc(s.nome)}</option>`).join("")}</select></label>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" id="d-vai" ${a.vai !== false ? "checked" : ""} /> <span style="margin:0">Vai ao evento</span></label>
      <label class="campo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" id="d-presenca" ${a.presenca ? "checked" : ""} /> <span style="margin:0">Presença confirmada</span></label>
      <label class="campo"><span>Observação</span><textarea class="input" id="d-obs" rows="2">${esc(a.observacao || "")}</textarea></label>
      <button class="btn btn-primario" id="d-salvar">Salvar alterações</button>
    </div>

    <div class="secao">
      <h4>Links</h4>
      ${linkBox("Link de convite", linkConvite)}
      ${linkBox("Painel do anfitrião", linkPainel)}
    </div>

    <div class="secao">
      <h4>Convidados (${convidados.length})</h4>
      ${
        convidados.length
          ? convidados
              .map(
                (c) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--cinza-100)">
          <span style="font-size:.85rem">${esc(c.nome || "—")}</span>
          <span class="badge ${badgeStatus(c.status)}">${esc(c.status)}</span></div>`
              )
              .join("")
          : `<p class="pagina-sub" style="margin:0">Nenhum convidado ainda.</p>`
      }
    </div>

    <div class="secao zona-perigo">
      <p>Excluir remove o anfitrião e todos os convidados dele.</p>
      <button class="btn btn-perigo" id="d-excluir">Excluir anfitrião</button>
    </div>`
  );

  const g = document.getElementById("gaveta");
  g.querySelector("#d-salvar").onclick = async () => {
    try {
      const catConv = g.querySelector("#d-categoria-convidado").value.trim() || null;
      const atualizado = await salvar("anfitrioes", {
        id: a.id,
        email: g.querySelector("#d-email").value.trim() || null,
        telefone: g.querySelector("#d-telefone").value.trim() || null,
        responsavel_id: g.querySelector("#d-resp").value || null,
        grupo_id: g.querySelector("#d-grupo").value || null,
        categoria_convidado: catConv,
        estagio_id: g.querySelector("#d-estagio").value || null,
        vai: g.querySelector("#d-vai").checked,
        presenca: g.querySelector("#d-presenca").checked,
        observacao: g.querySelector("#d-obs").value.trim() || null,
      });
      if (catConv !== (a.categoria_convidado || null)) {
        await reSincCategoriaAnfitriao(a.id, catConv).catch(() => {});
      }
      await sincAnfitriaoParticipante(atualizado).catch((e) => console.warn(e));
      toast("Anfitrião atualizado.", "ok");
      lista = await listAnfitrioes();
      render();
      fecharGaveta();
    } catch (e) {
      toast(e.message, "erro");
    }
  };
  g.querySelector("#d-excluir").onclick = () => excluir(a.id);
  g.querySelectorAll("[data-copiar]").forEach((b) => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copiar).then(() => toast("Link copiado.", "ok"));
    };
  });
}

function linkBox(rotulo, url) {
  return `<div class="campo">
    <span>${esc(rotulo)}</span>
    <div style="display:flex;gap:6px">
      <input class="input" readonly value="${esc(url)}" style="font-size:.78rem" />
      <button class="btn btn-secundario" data-copiar="${esc(url)}">Copiar</button>
    </div>
  </div>`;
}

async function excluir(id) {
  const a = lista.find((x) => x.id === id);
  if (!confirmar(`Excluir "${a?.nome}" e seus convidados?`)) return;
  try {
    await desvincularAoExcluirAnfitriao(a).catch(() => {});
    await remover("anfitrioes", id);
    toast("Anfitrião excluído.", "ok");
    fecharGaveta();
    lista = await listAnfitrioes();
    render();
  } catch (e) {
    toast(e.message, "erro");
  }
}

function badgeStatus(s) {
  return { Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro";
}
