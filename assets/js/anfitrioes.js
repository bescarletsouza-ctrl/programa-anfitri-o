// =============================================================================
// Gestão de anfitriões — tabela, filtros, modal "novo", gaveta de detalhe.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, slugify, gerarSlugAnfitriao, telParaWhatsApp,
  abrirModal, abrirGaveta, fecharGaveta, toast, confirmar, icone,
} from "./ui.js";
import {
  listEstagios, listGrupos, listAnfitrioes, listarEquipe, listTiposIngresso,
  listConvidadosDoAnfitriao, salvar, remover, inserirLote, reSincCategoriaAnfitriao, reSincResponsavelAnfitriao,
  sincAnfitriaoParticipante, desvincularAoExcluirAnfitriao,
} from "./supabase.js";
import { APP, TIPOS_ANFITRIAO } from "./config.js";
import { parsearTabela, lerXlsx, baixarXLSX, baixarModeloXLSX } from "./tabela.js";

const _iniciando = iniciarPagina("anfitrioes");
const el = (id) => document.getElementById(id);

let CTX = null;
let estagios = [], grupos = [], membrosOrg = [], tiposIngresso = [], lista = [];
let aba = "todos";
const filtros = { busca: "", grupo: "", estagio: "", presenca: "" };

_iniciando.then((ctx) => { if (ctx) { CTX = ctx; carregar(ctx); } });

async function carregar() {
  try {
    [estagios, grupos, membrosOrg, tiposIngresso, lista] = await Promise.all([
      listEstagios(), listGrupos(),
      CTX?.org?.id ? listarEquipe(CTX.org.id).catch(() => []) : Promise.resolve([]),
      listTiposIngresso().catch(() => []),
      listAnfitrioes(),
    ]);
    preencherSelect(el("f-grupo"), grupos, "Todos os tipos");
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
el("btn-exportar").innerHTML = icone("baixar") + "Exportar Excel";
el("btn-exportar").onclick = () => exportar(filtrar());

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
function respDoGrupo(grupoId) { return grupos.find((g) => g.id === grupoId)?.responsavel_user_id || null; }
function nomeMembro(uid) {
  const m = membrosOrg.find((x) => x.user_id === uid);
  return m ? (m.nome || m.email) : "";
}

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

// sugestões pro campo "Categoria liberada": os Tipos de ingresso cadastrados
// + qualquer valor antigo que já tenha sido usado (mesmo que não seja mais
// um tipo de ingresso ativo)
const categoriasUsadas = () =>
  [...new Set([
    ...tiposIngresso.map((t) => (t.nome || "").trim()),
    ...lista.map((a) => (a.categoria_convidado || "").trim()),
  ].filter(Boolean))].sort();

function emailDuplicado(email, idExcluir) {
  const alvo = (email || "").trim().toLowerCase();
  if (!alvo) return false;
  return lista.some((a) => a.id !== idExcluir && (a.email || "").trim().toLowerCase() === alvo);
}

/* ---- Novo anfitrião ---- */
function modalNovo() {
  abrirModal({
    titulo: "Novo anfitrião",
    textoConfirmar: "Criar",
    corpoHtml: `
      <label class="campo"><span>Papel</span>
        <select class="select" name="tipo">${TIPOS_ANFITRIAO.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label class="campo"><span>Nome completo *</span><input class="input" name="nome" required /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" /></label>
      <label class="campo"><span>Tipo</span>
        <select class="select" name="grupo_id"><option value="">—</option>
          ${grupos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Categoria de ingresso</span>
        <select class="select" name="ingresso"><option value="">— sem categoria —</option>
          ${tiposIngresso.map((t) => `<option>${esc(t.nome)}</option>`).join("")}</select>
        <span class="cel-tenue" style="font-size:.72rem">A categoria dele mesmo — vai junto para Participantes.</span></label>
      <label class="campo"><span>Categoria liberada para os convidados dele</span>
        <input class="input" name="categoria_convidado" list="cats-anf" placeholder="Ex.: VIP, GOLD…" />
        <datalist id="cats-anf">${categoriasUsadas().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="campo"><span>Responsável</span>
        <select class="select" name="responsavel_user_id"><option value="">—</option>
          ${membrosOrg.map((m) => `<option value="${esc(m.user_id)}">${esc(m.nome || m.email)}</option>`).join("")}</select>
        <span class="cel-tenue" style="font-size:.72rem">Preenchido sozinho conforme o Tipo, se ele tiver um responsável.</span></label>`,
    aoMontar: (root) => {
      const selTipo = root.querySelector('[name="grupo_id"]');
      const selResp = root.querySelector('[name="responsavel_user_id"]');
      selTipo.onchange = () => {
        const r = respDoGrupo(selTipo.value);
        if (r) selResp.value = r;
      };
    },
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const email = f.email.trim();
      if (email && emailDuplicado(email, null)) {
        toast("Já existe um anfitrião cadastrado com esse e-mail.", "erro");
        return false;
      }
      const nome = f.nome.trim();
      const dados = {
        tipo: f.tipo, nome, email: email || null, telefone: f.telefone || null,
        grupo_id: f.grupo_id || null, ingresso: f.ingresso || null, responsavel_user_id: f.responsavel_user_id || null,
        categoria_convidado: f.categoria_convidado.trim() || null,
        estagio_id: estagios[0]?.id || null,
      };
      let novo;
      for (let tentativa = 0; ; tentativa++) {
        try {
          novo = await salvar("anfitrioes", { ...dados, slug: gerarSlugAnfitriao(nome) });
          break;
        } catch (e) {
          if (tentativa < 4 && /duplicate key.*slug/i.test(e.message || "")) continue; // slug já existia, tenta outro
          throw e;
        }
      }
      await sincAnfitriaoParticipante(novo).catch((e) => console.warn(e));
      toast("Anfitrião criado.", "ok");
      lista = await listAnfitrioes();
      render();
      abrirGavetaDetalhe(novo.id);
    },
  });
}

/* ---- Importar lista ---- */
const MODELO_LINHAS = [
  ["nome", "email", "telefone", "tipo", "grupo", "categoria"],
  ["Maria Silva", "maria@exemplo.com", "11999990000", "Titular", "Turma 1", "VIP"],
  ["João Souza", "joao@exemplo.com", "11988887777", "Titular", "Turma 1", ""],
];

const ALIAS = {
  "nome completo": "nome", "e-mail": "email",
  whatsapp: "telefone", celular: "telefone", fone: "telefone",
  turma: "grupo", ingresso: "categoria", "categoria de ingresso": "categoria",
};

function modalImportar() {
  abrirModal({
    titulo: "Importar lista de anfitriões",
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole uma tabela (do Excel/Sheets) ou selecione um arquivo Excel (.xlsx).
        Colunas aceitas: <b>nome</b> (obrigatória), email, telefone, tipo, grupo,
        categoria. Grupo (Tipo) é criado automaticamente se ainda não existir —
        e se esse Tipo já tiver um responsável cadastrado em Configurações, ele
        é atribuído ao anfitrião automaticamente.
      </p>
      <button type="button" id="imp-modelo" style="font-size:.8rem;font-weight:600;color:var(--cor-laranja-forte);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline">↓ baixar modelo</button>
      <label class="campo" style="margin-top:12px"><span>Colar tabela</span>
        <textarea class="input" name="texto" rows="7" placeholder="nome,email,telefone,tipo,grupo&#10;Maria Silva,maria@exemplo.com,..."></textarea></label>
      <label class="campo"><span>…ou arquivo Excel (.xlsx)</span>
        <input class="input" type="file" name="arquivo" accept=".xlsx,.xls" /></label>
      <div class="pagina-sub" id="imp-status" style="margin:0"></div>`,
    aoMontar: (root) => {
      root.querySelector("#imp-modelo").onclick = () => baixarModeloXLSX("modelo-anfitrioes.xlsx", MODELO_LINHAS);
    },
    onConfirmar: async (form) => {
      const arquivo = form.querySelector('[name="arquivo"]').files[0];
      const linhas = arquivo
        ? await lerXlsx(arquivo, ALIAS)
        : parsearTabela(form.querySelector('[name="texto"]').value, ALIAS);
      const validas = linhas.filter((l) => (l.nome || "").trim());
      if (!validas.length) {
        toast("Nenhuma linha com nome encontrada. Confira o cabeçalho.", "erro");
        return false;
      }

      // resolve/cria grupos (Tipo) por nome; responsável vem do Tipo, sozinho
      const mapaGrupo = new Map(grupos.map((g) => [g.nome.toLowerCase(), g.id]));
      const mapaGrupoResp = new Map(grupos.map((g) => [g.id, g.responsavel_user_id || null]));
      let criouAux = false;

      for (const l of validas) {
        if (l.grupo && !mapaGrupo.has(l.grupo.toLowerCase())) {
          const g = await salvar("grupos", { nome: l.grupo.trim() });
          mapaGrupo.set(g.nome.toLowerCase(), g.id);
          mapaGrupoResp.set(g.id, g.responsavel_user_id || null);
          criouAux = true;
        }
      }

      const registros = validas.map((l) => {
        const grupoId = l.grupo ? mapaGrupo.get(l.grupo.toLowerCase()) || null : null;
        const nome = l.nome.trim();
        return {
          nome,
          slug: gerarSlugAnfitriao(nome),
          email: (l.email || "").trim() || null,
          telefone: (l.telefone || "").trim() || null,
          tipo: TIPOS_ANFITRIAO.includes((l.tipo || "").trim()) ? l.tipo.trim() : "Titular",
          grupo_id: grupoId,
          ingresso: (l.categoria || "").trim() || null,
          responsavel_user_id: grupoId ? mapaGrupoResp.get(grupoId) || null : null,
          estagio_id: estagios[0]?.id || null,
        };
      });

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
      if (criouAux) grupos = await listGrupos();
      preencherSelect(el("f-grupo"), grupos, "Todos os tipos", filtros.grupo);
      lista = await listAnfitrioes();
      render();
    },
  });
}

/* ---- Exportar ---- */
async function exportar(dados) {
  if (!dados.length) { toast("Nada para exportar.", "erro"); return; }
  await baixarXLSX("anfitrioes.xlsx", dados, [
    { chave: "nome", rotulo: "Nome" },
    { chave: "tipo", rotulo: "Papel" },
    { rotulo: "Tipo", valor: (a) => nomeGrupo(a.grupo_id) || "" },
    { chave: "ingresso", rotulo: "Categoria de ingresso" },
    { chave: "email", rotulo: "E-mail" },
    { chave: "telefone", rotulo: "Telefone" },
    { rotulo: "Responsável", valor: (a) => nomeMembro(a.responsavel_user_id) },
    { rotulo: "Estágio", valor: (a) => nomeEstagio(a.estagio_id) },
    { chave: "categoria_convidado", rotulo: "Categoria liberada" },
    { rotulo: "Vai ao evento", valor: (a) => (a.vai !== false ? "Sim" : "Não") },
    { rotulo: "Presença", valor: (a) => (a.presenca ? "Sim" : "Não") },
    { rotulo: "Enviados", valor: (a) => a.enviados || 0 },
    { rotulo: "Aprovados", valor: (a) => a.aprovados || 0 },
    { rotulo: "Confirmados", valor: (a) => a.confirmados || 0 },
    { rotulo: "Cadastro", valor: (a) => formatarData(a.created_at) },
  ]);
  toast("Arquivo gerado.", "ok");
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
          ${membrosOrg.map((m) => `<option value="${esc(m.user_id)}" ${m.user_id === a.responsavel_user_id ? "selected" : ""}>${esc(m.nome || m.email)}</option>`).join("")}</select></label>
      <label class="campo"><span>Tipo</span>
        <select class="select" id="d-grupo"><option value="">—</option>
          ${grupos.map((g) => `<option value="${g.id}" ${g.id === a.grupo_id ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Categoria de ingresso</span>
        <select class="select" id="d-ingresso"><option value="">— sem categoria —</option>
          ${tiposIngresso.map((t) => `<option ${t.nome === a.ingresso ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select></label>
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
  g.querySelector("#d-grupo").onchange = (e) => {
    const r = respDoGrupo(e.target.value);
    if (r) g.querySelector("#d-resp").value = r;
  };
  g.querySelector("#d-salvar").onclick = async () => {
    try {
      const emailNovo = g.querySelector("#d-email").value.trim();
      if (emailNovo && emailDuplicado(emailNovo, a.id)) {
        toast("Já existe outro anfitrião cadastrado com esse e-mail.", "erro");
        return;
      }
      const catConv = g.querySelector("#d-categoria-convidado").value.trim() || null;
      const atualizado = await salvar("anfitrioes", {
        id: a.id,
        email: emailNovo || null,
        telefone: g.querySelector("#d-telefone").value.trim() || null,
        responsavel_user_id: g.querySelector("#d-resp").value || null,
        grupo_id: g.querySelector("#d-grupo").value || null,
        ingresso: g.querySelector("#d-ingresso").value || null,
        categoria_convidado: catConv,
        estagio_id: g.querySelector("#d-estagio").value || null,
        vai: g.querySelector("#d-vai").checked,
        presenca: g.querySelector("#d-presenca").checked,
        observacao: g.querySelector("#d-obs").value.trim() || null,
      });
      if (catConv !== (a.categoria_convidado || null)) {
        await reSincCategoriaAnfitriao(a.id, catConv).catch(() => {});
      }
      if (atualizado.responsavel_user_id !== (a.responsavel_user_id || null)) {
        await reSincResponsavelAnfitriao(a.id, atualizado.responsavel_user_id).catch(() => {});
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
