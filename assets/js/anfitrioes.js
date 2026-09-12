// =============================================================================
// Gestão de anfitriões — tabela, filtros, modal "novo", gaveta de detalhe.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, slugify, gerarSlugAnfitriao, telParaWhatsApp,
  abrirModal, abrirGaveta, fecharGaveta, abrirMenu, toast, confirmar, icone,
} from "./ui.js";
import {
  listEstagios, listGrupos, listAnfitrioes, listarEquipe, listTiposIngresso,
  listConvidadosDoAnfitriao, salvar, remover, inserirLote, atualizarEmLote, removerEmLote,
  reSincCategoriaAnfitriao, reSincResponsavelAnfitriao,
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
const selecionados = new Set();

// Colunas opcionais da lista (Nome e ações são fixas). Ordem + visibilidade
// ficam salvas no navegador.
const COLUNAS = {
  tipo:      "Tipo",
  email:     "E-mail",
  telefone:  "Telefone",
  categoria: "Categoria de ingresso",
  categoriaConvidado: "Categoria liberada",
  responsavel: "Responsável",
  estagio:   "Estágio",
  presenca:  "Presença",
  enviados:  "Enviados",
  aprovados: "Aprovados",
  cadastro:  "Cadastro",
};
const COLUNAS_PADRAO = ["tipo", "email", "telefone", "presenca", "enviados", "aprovados"];
let colunas = [...COLUNAS_PADRAO];
try {
  const s = JSON.parse(localStorage.getItem("anf_colunas") || "null");
  if (Array.isArray(s) && s.length) colunas = s.filter((c) => COLUNAS[c]);
} catch {}
const salvarColunas = () => { try { localStorage.setItem("anf_colunas", JSON.stringify(colunas)); } catch {} };

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
el("btn-colunas").innerHTML = icone("filtro") + "Colunas";
el("btn-colunas").onclick = modalColunas;
el("barra-acoes").querySelectorAll("[data-acao]").forEach((b) => {
  b.onclick = () => acaoEmMassa(b.dataset.acao);
});

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

// Igual à Participantes: a categoria de ingresso manda primeiro (tem
// responsável mais específico); o Tipo é o fallback.
function responsavelAutomatico(grupoId, ingressoNome) {
  if (ingressoNome) {
    const t = tiposIngresso.find((x) => (x.nome || "").trim().toLowerCase() === ingressoNome.trim().toLowerCase());
    if (t?.responsavel_user_id) return t.responsavel_user_id;
  }
  return respDoGrupo(grupoId);
}

// Quem sobe como anfitrião entra com o Tipo "Anfitrião" por padrão — mesmo
// Tipo usado em Participantes. Cria o grupo na primeira vez que for preciso.
async function grupoAnfitriaoId() {
  const existente = grupos.find((g) => (g.nome || "").trim().toLowerCase() === "anfitrião");
  if (existente) return existente.id;
  const novo = await salvar("grupos", { nome: "Anfitrião" });
  grupos = [...grupos, novo];
  return novo.id;
}
function nomeMembro(uid) {
  const m = membrosOrg.find((x) => x.user_id === uid);
  return m ? (m.nome || m.email) : "";
}

function sincronizarBarra(dados) {
  const n = selecionados.size;
  el("barra-acoes").hidden = n === 0;
  el("sel-cont").textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
  const todos = el("check-todos");
  const noFiltro = dados.filter((a) => selecionados.has(a.id)).length;
  todos.checked = dados.length > 0 && noFiltro === dados.length;
  todos.indeterminate = noFiltro > 0 && noFiltro < dados.length;
}

function renderCabecalho() {
  el("thead-anf").innerHTML =
    `<th class="col-check"><input type="checkbox" id="check-todos" aria-label="Selecionar todos" /></th>
     <th>Nome</th>
     ${colunas.map((c) => `<th>${esc(COLUNAS[c])}</th>`).join("")}
     <th></th>`;
  el("check-todos").onchange = (e) => {
    const dados = filtrar();
    if (e.target.checked) dados.forEach((a) => selecionados.add(a.id));
    else dados.forEach((a) => selecionados.delete(a.id));
    render();
  };
}

function celulaColuna(a, c) {
  switch (c) {
    case "tipo": { const g = nomeGrupo(a.grupo_id); return g ? `<span class="badge badge-laranja">${esc(g)}</span>` : "—"; }
    case "email": return esc(a.email || "—");
    case "telefone": return esc(a.telefone || "—");
    case "categoria": return esc(a.ingresso || "—");
    case "categoriaConvidado": return esc(a.categoria_convidado || "—");
    case "responsavel": return esc(nomeMembro(a.responsavel_user_id) || "—");
    case "estagio": return `<span class="badge badge-neutro">${esc(nomeEstagio(a.estagio_id))}</span>`;
    case "presenca": return a.presenca ? '<span class="badge badge-ok">Sim</span>' : '<span class="badge badge-neutro">Não</span>';
    case "enviados": return a.enviados || 0;
    case "aprovados": return a.aprovados || 0;
    case "cadastro": return esc(formatarData(a.created_at));
    default: return "—";
  }
}

function render() {
  renderCabecalho();
  const filtrada = filtrar();
  el("contador").textContent = `Exibindo ${filtrada.length} de ${lista.length} anfitriões`;
  const vazio = filtrada.length === 0;
  el("wrap").hidden = vazio;
  el("vazio").hidden = !vazio;
  [...selecionados].forEach((id) => { if (!filtrada.some((a) => a.id === id)) selecionados.delete(id); });
  sincronizarBarra(filtrada);
  if (vazio) return;

  el("linhas").innerHTML = filtrada
    .map((a) => {
      return `<tr data-id="${a.id}">
        <td class="col-check"><input type="checkbox" data-check ${selecionados.has(a.id) ? "checked" : ""} /></td>
        <td><strong>${esc(a.nome)}</strong><div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(a.tipo || "")}</div></td>
        ${colunas.map((c) => `<td>${celulaColuna(a, c)}</td>`).join("")}
        <td class="linha-acoes">
          <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
          <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
        </td>
      </tr>`;
    })
    .join("");

  el("linhas").querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector("[data-check]").onclick = (e) => e.stopPropagation();
    tr.querySelector("[data-check]").onchange = (e) => {
      e.target.checked ? selecionados.add(id) : selecionados.delete(id);
      sincronizarBarra(filtrar());
    };
    tr.onclick = (e) => {
      if (e.target.closest("[data-excluir]")) return excluir(id);
      if (e.target.closest("[data-editar]")) return abrirGavetaDetalhe(id);
      if (e.target.closest("[data-check]")) return;
      abrirGavetaDetalhe(id);
    };
  });
}

function modalColunas() {
  let ordem = [...colunas, ...Object.keys(COLUNAS).filter((c) => !colunas.includes(c))];
  const visiveis = new Set(colunas);
  const corpo = () => ordem.map((c, i) => `
    <div class="col-cfg" data-c="${c}">
      <label><input type="checkbox" data-vis ${visiveis.has(c) ? "checked" : ""} /> ${esc(COLUNAS[c])}</label>
      <span class="linha-acoes">
        <button type="button" class="icone-btn" data-mv="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
        <button type="button" class="icone-btn" data-mv="1" ${i === ordem.length - 1 ? "disabled" : ""} aria-label="Descer">▼</button>
      </span>
    </div>`).join("");

  abrirModal({
    titulo: "Colunas da lista",
    textoConfirmar: "Aplicar",
    corpoHtml: `<p class="pagina-sub" style="margin:0 0 12px">Marque as colunas que aparecem e use ▲ ▼ para reordenar. Nome fica sempre visível.</p>
      <div id="col-lista">${corpo()}</div>
      <button type="button" class="btn btn-fantasma btn-sm" id="col-reset" style="margin-top:8px">Restaurar padrão</button>`,
    aoMontar: (root) => {
      const redraw = () => { root.querySelector("#col-lista").innerHTML = corpo(); wire(); };
      const wire = () => {
        root.querySelectorAll(".col-cfg").forEach((row) => {
          const c = row.dataset.c;
          row.querySelector("[data-vis]").onchange = (e) => {
            e.target.checked ? visiveis.add(c) : visiveis.delete(c);
          };
          row.querySelectorAll("[data-mv]").forEach((b) => {
            b.onclick = () => {
              const i = ordem.indexOf(c);
              const j = i + Number(b.dataset.mv);
              if (j < 0 || j >= ordem.length) return;
              [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
              redraw();
            };
          });
        });
      };
      wire();
      root.querySelector("#col-reset").onclick = () => {
        ordem = [...COLUNAS_PADRAO, ...Object.keys(COLUNAS).filter((c) => !COLUNAS_PADRAO.includes(c))];
        visiveis.clear();
        COLUNAS_PADRAO.forEach((c) => visiveis.add(c));
        redraw();
      };
    },
    onConfirmar: () => {
      colunas = ordem.filter((c) => visiveis.has(c));
      if (!colunas.length) colunas = [...COLUNAS_PADRAO];
      salvarColunas();
      render();
    },
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
  const grupoAnfitriaoLocal = grupos.find((g) => (g.nome || "").trim().toLowerCase() === "anfitrião")?.id || "";
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
        <select class="select" name="grupo_id">
          ${grupoAnfitriaoLocal ? "" : `<option value="" selected>Anfitrião</option>`}
          ${grupos.map((g) => `<option value="${g.id}" ${g.id === grupoAnfitriaoLocal ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}</select>
        <span class="cel-tenue" style="font-size:.72rem">Por padrão, todo anfitrião entra com o Tipo "Anfitrião" — mesmo Tipo usado em Participantes.</span></label>
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
        <span class="cel-tenue" style="font-size:.72rem">Preenchido sozinho conforme a Categoria de ingresso ou o Tipo, se algum deles tiver um responsável.</span></label>`,
    aoMontar: (root) => {
      const selTipo = root.querySelector('[name="grupo_id"]');
      const selIngresso = root.querySelector('[name="ingresso"]');
      const selResp = root.querySelector('[name="responsavel_user_id"]');
      const atualizarResp = () => {
        const r = responsavelAutomatico(selTipo.value, selIngresso.value || null);
        if (r) selResp.value = r;
      };
      selTipo.onchange = atualizarResp;
      selIngresso.onchange = atualizarResp;
      atualizarResp();
    },
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const email = f.email.trim();
      if (email && emailDuplicado(email, null)) {
        toast("Já existe um anfitrião cadastrado com esse e-mail.", "erro");
        return false;
      }
      const nome = f.nome.trim();
      const grupoId = f.grupo_id || (await grupoAnfitriaoId());
      const dados = {
        tipo: f.tipo, nome, email: email || null, telefone: f.telefone || null,
        grupo_id: grupoId, ingresso: f.ingresso || null, responsavel_user_id: f.responsavel_user_id || null,
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
  ["nome", "email", "telefone", "tipo", "grupo", "categoria", "categoria_convidados"],
  ["Maria Silva", "maria@exemplo.com", "11999990000", "Titular", "Turma 1", "VIP", "GOLD"],
  ["João Souza", "joao@exemplo.com", "11988887777", "Titular", "Turma 1", "", ""],
];

const ALIAS = {
  "nome completo": "nome", "e-mail": "email",
  whatsapp: "telefone", celular: "telefone", fone: "telefone",
  turma: "grupo", ingresso: "categoria", "categoria de ingresso": "categoria",
  categoria_convidados: "categoria_convidado", "categoria dos convidados": "categoria_convidado",
  "categoria liberada": "categoria_convidado", "categoria liberada para convidados": "categoria_convidado",
  "ingresso dos convidados": "categoria_convidado", "ingresso liberado": "categoria_convidado",
};

function modalImportar() {
  abrirModal({
    titulo: "Importar lista de anfitriões",
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole uma tabela (do Excel/Sheets) ou selecione um arquivo Excel (.xlsx).
        Colunas aceitas: <b>nome</b> (obrigatória), email, telefone, tipo, grupo,
        categoria (a categoria de ingresso do próprio anfitrião) e
        categoria_convidados (a categoria liberada para os convidados dele).
        Grupo (Tipo) é criado automaticamente se ainda não existir — sem essa
        coluna, o anfitrião entra com o Tipo "Anfitrião". O responsável é
        atribuído sozinho a partir da categoria de ingresso ou do Tipo, se
        algum dos dois já tiver um responsável cadastrado em Configurações.
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

      // resolve/cria grupos (Tipo) por nome; sem grupo na planilha, usa "Anfitrião"
      const mapaGrupo = new Map(grupos.map((g) => [g.nome.toLowerCase(), g.id]));
      let criouAux = false;

      for (const l of validas) {
        if (l.grupo && !mapaGrupo.has(l.grupo.toLowerCase())) {
          const g = await salvar("grupos", { nome: l.grupo.trim() });
          mapaGrupo.set(g.nome.toLowerCase(), g.id);
          grupos = [...grupos, g];
          criouAux = true;
        }
      }
      const grupoPadraoId = validas.some((l) => !l.grupo) ? await grupoAnfitriaoId() : null;
      if (grupoPadraoId) criouAux = true;

      const registros = validas.map((l) => {
        const grupoId = l.grupo ? mapaGrupo.get(l.grupo.toLowerCase()) || null : grupoPadraoId;
        const ingresso = (l.categoria || "").trim() || null;
        const nome = l.nome.trim();
        return {
          nome,
          slug: gerarSlugAnfitriao(nome),
          email: (l.email || "").trim() || null,
          telefone: (l.telefone || "").trim() || null,
          tipo: TIPOS_ANFITRIAO.includes((l.tipo || "").trim()) ? l.tipo.trim() : "Titular",
          grupo_id: grupoId,
          ingresso,
          categoria_convidado: (l.categoria_convidado || "").trim() || null,
          responsavel_user_id: responsavelAutomatico(grupoId, ingresso),
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
  const linkConvite = `${base}${APP.urlConvitePublico}-${a.slug}` +
    `?utm_source=anfitriao&utm_medium=${slugify(a.nome)}` +
    (a.grupo_id ? `&utm_campaign=${slugify(nomeGrupo(a.grupo_id) || "")}` : "");
  const linkPainel = `${base}${APP.urlPainelAnfitriao}-${a.slug}`;

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
  const atualizarRespGaveta = () => {
    const r = responsavelAutomatico(g.querySelector("#d-grupo").value, g.querySelector("#d-ingresso").value || null);
    if (r) g.querySelector("#d-resp").value = r;
  };
  g.querySelector("#d-grupo").onchange = atualizarRespGaveta;
  g.querySelector("#d-ingresso").onchange = atualizarRespGaveta;
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

/* ---- Ações em massa ---- */
async function acaoEmMassa(acao) {
  const ids = [...selecionados];
  if (!ids.length && acao !== "limpar") return;

  if (acao === "limpar") { selecionados.clear(); render(); return; }

  if (acao === "exportar") {
    exportar(lista.filter((a) => selecionados.has(a.id)));
    return;
  }

  if (acao === "excluir") {
    if (!confirmar(`Excluir ${ids.length} anfitrião(ões) e seus convidados?`)) return;
    try {
      for (const id of ids) {
        await desvincularAoExcluirAnfitriao(lista.find((x) => x.id === id)).catch(() => {});
      }
      await removerEmLote("anfitrioes", ids);
      selecionados.clear();
      toast(`${ids.length} anfitrião(ões) excluído(s).`, "ok");
      lista = await listAnfitrioes();
      render();
    } catch (e) { toast(e.message, "erro"); }
    return;
  }

  // tipo / categoria / responsável → menu ancorado no botão
  const btn = el("barra-acoes").querySelector(`[data-acao="${acao}"]`);
  let itens;
  if (acao === "tipo") itens = grupos.map((g) => ({ valor: g.id, rotulo: g.nome }));
  else if (acao === "categoria") itens = [{ valor: "", rotulo: "— sem categoria —" }, ...tiposIngresso.map((t) => ({ valor: t.nome, rotulo: t.nome }))];
  else itens = [{ valor: "", rotulo: "Sem responsável" }, ...membrosOrg.map((m) => ({ valor: m.user_id, rotulo: m.nome || m.email }))];
  const escolha = await abrirMenu(btn, itens);
  if (escolha === null) return;
  try {
    if (acao === "responsavel") {
      await atualizarEmLote("anfitrioes", ids, { responsavel_user_id: escolha || null });
    } else {
      // tipo/categoria: o responsável (que depende dos dois juntos) é
      // recalculado por linha, igual em Participantes
      const patch = acao === "tipo" ? { grupo_id: escolha || null } : { ingresso: escolha || null };
      await atualizarEmLote("anfitrioes", ids, patch);
      lista = await listAnfitrioes();
      for (const a of lista.filter((x) => selecionados.has(x.id))) {
        const atualizado = await salvar("anfitrioes", {
          id: a.id, responsavel_user_id: responsavelAutomatico(a.grupo_id, a.ingresso),
        }).catch((e) => { console.warn(e); return null; });
        if (atualizado) await sincAnfitriaoParticipante(atualizado).catch((e) => console.warn(e));
      }
    }
    selecionados.clear();
    toast(`${ids.length} anfitrião(ões) atualizado(s).`, "ok");
    lista = await listAnfitrioes();
    render();
  } catch (e) { toast(e.message, "erro"); }
}

function badgeStatus(s) {
  return { Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro";
}
