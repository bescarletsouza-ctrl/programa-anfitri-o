// =============================================================================
// Atividades — cadastro de palestras/sessões (horário, vagas, categorias
// liberadas) e painel de quem está credenciado em cada uma. O credenciamento
// em si é feito na tela de Check-in (modo atividade).
// =============================================================================
import { iniciarPagina, esc, icone, toast, confirmar, abrirModal, abrirGaveta, debounce, formatarData } from "./ui.js";
import {
  listAtividades, listCheckins, listParticipantes, salvar, remover,
  registrarCheckin, inserirLote, removerCheckinsAtividade,
} from "./supabase.js";
import { parsearTabela, gerarCSV, baixarCSV } from "./tabela.js";

iniciarPagina("atividades");
const el = (id) => document.getElementById(id);

let atividades = [];
let checkins = [];
let participantes = [];

carregar();
el("btn-atualizar").onclick = () => carregar();
el("nova-atividade").onclick = () => editar(null);

async function carregar() {
  try {
    [atividades, checkins, participantes] = await Promise.all([
      listAtividades(),
      listCheckins().catch(() => []),
      listParticipantes().catch(() => []),
    ]);
    el("carregando").hidden = true;
    el("painel").hidden = false;
    render();
  } catch (e) {
    const falta = /atividades|atividade_id|schema cache|does not exist/.test(e.message || "");
    el("carregando").innerHTML = falta
      ? `Rode a migração <code>supabase/migrations/0009_atividades.sql</code> no SQL Editor do Supabase para ativar as atividades.`
      : "Erro ao carregar: " + esc(e.message);
  }
}

const hora = (iso) => {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
};

function diaLabel(d) {
  if (!d) return "";
  const [a, m, dd] = String(d).split("-");
  return dd ? `${dd}/${m}/${a}` : String(d);
}

function horarioLinha(atv) {
  const faixa = [atv.inicio, atv.fim].filter(Boolean).join("–");
  return [diaLabel(atv.dia), faixa].filter(Boolean).join(" · ") || "Sem horário definido";
}

// participantes com entrada "líquida" (entradas − saídas > 0) em uma atividade
function credenciadosDe(atvId) {
  const estado = new Map(); // pid → { saldo, desde, p }
  // checkins vem em ordem decrescente de data
  for (const c of checkins) {
    if (c.atividade_id !== atvId) continue;
    const cur = estado.get(c.participante_id) || { saldo: 0, desde: null, p: c.participante || {} };
    if (c.acao === "entrada") { cur.saldo++; if (!cur.desde) cur.desde = c.at; }
    else cur.saldo--;
    estado.set(c.participante_id, cur);
  }
  return [...estado.entries()]
    .filter(([, v]) => v.saldo > 0)
    .map(([pid, v]) => ({
      pid,
      nome: v.p.nome || "—",
      categoria: v.p.ingresso || v.p.tipo || "",
      email: v.p.email || "",
      empresa: v.p.empresa || "",
      codigo: v.p.codigo || "",
      desde: v.desde,
    }));
}

const categoriasUsadas = () => {
  const s = new Set();
  participantes.forEach((p) => { const c = (p.ingresso || "").trim(); if (c) s.add(c); });
  atividades.forEach((a) => (a.categorias || []).forEach((c) => c && s.add(c)));
  return [...s].sort();
};

function render() {
  el("vazio").hidden = atividades.length > 0;
  el("lista").innerHTML = atividades.map(cardHtml).join("");
  el("lista").querySelectorAll("[data-id]").forEach((card) => {
    const atv = atividades.find((a) => a.id === card.dataset.id);
    card.querySelector("[data-editar]").onclick = () => editar(atv);
    card.querySelector("[data-excluir]").onclick = () => excluir(atv);
    card.querySelector("[data-credenciados]").onclick = () => abrirGavetaAtv(atv, "lista");
    card.querySelector("[data-importar]").onclick = () => abrirGavetaAtv(atv, "add");
  });
}

function cardHtml(atv) {
  const cred = credenciadosDe(atv.id).length;
  const temVagas = Number.isFinite(atv.vagas) && atv.vagas > 0;
  const pct = temVagas ? Math.min(100, Math.round((cred / atv.vagas) * 100)) : 0;
  const lotada = temVagas && cred >= atv.vagas;
  const cats = (atv.categorias || []).filter(Boolean);
  return `<div class="card atv-card" data-id="${atv.id}">
    <div class="barra-topo" style="margin:0 0 10px">
      <div style="min-width:0">
        <h3 style="margin:0 0 3px;text-transform:none;font-size:1rem;letter-spacing:normal;color:var(--texto)">${esc(atv.nome)}</h3>
        <div class="atv-horario">${esc(horarioLinha(atv))}</div>
      </div>
      <span class="linha-acoes">
        <button class="icone-btn" data-editar title="Editar">${icone("editar")}</button>
        <button class="icone-btn" data-excluir title="Excluir">${icone("excluir")}</button>
      </span>
    </div>
    <div class="atv-vagas">
      <div class="checkin-num" style="font-size:.86rem">
        <b style="font-size:1.3rem">${cred}</b>
        <span>${temVagas ? `de ${atv.vagas} vagas` : "credenciado(s)"}</span>
        ${lotada ? `<span class="chip-cat" style="background:var(--erro-bg);color:var(--erro)">Lotada</span>` : ""}
      </div>
      ${temVagas ? `<div class="checkin-barra" style="margin-top:6px"><i style="width:${pct}%;background:${lotada ? "var(--erro)" : "var(--ok-solid)"}"></i></div>` : ""}
    </div>
    <div class="atv-cats">
      ${cats.length
        ? cats.map((c) => `<span class="chip-cat">${esc(c)}</span>`).join("")
        : `<span class="cel-tenue" style="font-size:.78rem">Todas as categorias podem entrar</span>`}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-secundario btn-sm" data-credenciados>Ver credenciados</button>
      <button class="btn btn-primario btn-sm" data-importar>+ Adicionar participantes</button>
    </div>
  </div>`;
}

function editar(atv) {
  const cats = (atv?.categorias || []).join(", ");
  abrirModal({
    titulo: atv ? "Editar atividade" : "Nova atividade",
    corpoHtml: `
      <label class="campo"><span>Nome *</span>
        <input class="input" name="nome" required value="${esc(atv?.nome || "")}" /></label>
      <label class="campo"><span>Dia</span>
        <input class="input" name="dia" type="date" value="${esc(atv?.dia || "")}" /></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="campo"><span>Início</span>
          <input class="input" name="inicio" type="time" value="${esc(atv?.inicio || "")}" /></label>
        <label class="campo"><span>Fim</span>
          <input class="input" name="fim" type="time" value="${esc(atv?.fim || "")}" /></label>
      </div>
      <label class="campo"><span>Vagas (deixe vazio para ilimitado)</span>
        <input class="input" name="vagas" type="number" min="1" value="${atv?.vagas ?? ""}" /></label>
      <label class="campo"><span>Categorias que podem entrar (separe por vírgula; vazio = todas)</span>
        <input class="input" name="categorias" list="cats-atv" value="${esc(cats)}" placeholder="Ex.: VIP, GOLD" />
        <datalist id="cats-atv">${categoriasUsadas().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      const registro = {
        nome: f.nome.trim(),
        dia: f.dia || null,
        inicio: f.inicio || null,
        fim: f.fim || null,
        vagas: Number(f.vagas) > 0 ? Number(f.vagas) : null,
        categorias: f.categorias.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (atv) registro.id = atv.id;
      await salvar("atividades", registro);
      toast("Atividade salva.", "ok");
      carregar();
    },
  });
}

async function excluir(atv) {
  if (!confirmar(`Excluir a atividade "${atv.nome}"? Os credenciamentos dela também serão removidos.`)) return;
  try {
    await remover("atividades", atv.id);
    toast("Atividade excluída.", "ok");
    carregar();
  } catch (e) {
    toast(e.message, "erro");
  }
}

/* ---- Gaveta: credenciados / adicionar participantes --------------- */
let gavetaAtv = null;
let gavetaModo = "lista"; // "lista" | "add"
let gavetaBusca = "";
const selecionadosAdd = new Set();

function abrirGavetaAtv(atv, modo) {
  gavetaAtv = atv;
  gavetaModo = modo;
  gavetaBusca = "";
  selecionadosAdd.clear();
  selecionadosLista.clear();
  abrirGaveta(
    `${esc(atv.nome)}`,
    `<div class="toggle-abas" style="margin-bottom:14px">
       <button type="button" data-aba="lista" class="${modo === "lista" ? "ativo" : ""}">Credenciados</button>
       <button type="button" data-aba="add" class="${modo === "add" ? "ativo" : ""}">Adicionar</button>
     </div>
     <input class="input" id="ga-busca" placeholder="Buscar…" style="margin-bottom:12px" autocomplete="off" />
     <div id="ga-corpo"></div>`
  );
  const g = document.getElementById("gaveta");
  g.querySelectorAll("[data-aba]").forEach((b) => {
    b.onclick = () => {
      gavetaModo = b.dataset.aba;
      g.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x === b));
      renderGavetaCorpo();
    };
  });
  document.getElementById("ga-busca").addEventListener("input", debounce((e) => {
    gavetaBusca = e.target.value.trim().toLowerCase();
    renderGavetaCorpo();
  }, 150));
  renderGavetaCorpo();
}

function renderGavetaCorpo() {
  gavetaModo === "add" ? renderAdd() : renderLista();
}

const selecionadosLista = new Set();

function renderLista() {
  const alvo = document.getElementById("ga-corpo");
  if (!alvo || !gavetaAtv) return;
  const todos = credenciadosDe(gavetaAtv.id);
  let linhas = todos;
  if (gavetaBusca) linhas = linhas.filter((l) => `${l.nome} ${l.categoria} ${l.email} ${l.codigo}`.toLowerCase().includes(gavetaBusca));
  linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  if (!linhas.length) {
    alvo.innerHTML = `<div id="ga-bar"></div><p class="pagina-sub" style="margin:0">${gavetaBusca ? "Ninguém encontrado." : "Ninguém credenciado nesta atividade ainda."}</p>`;
    sincBarraLista(todos);
    return;
  }

  alvo.innerHTML = `<div id="ga-bar"></div>` + linhas
    .map((l) => `<label class="checkin-item" data-pid="${l.pid}" style="padding:10px 12px;cursor:pointer">
      <div class="checkin-item-info" style="flex-direction:row;align-items:center;gap:10px">
        <input type="checkbox" data-sel ${selecionadosLista.has(l.pid) ? "checked" : ""} />
        <span>
          <strong>${esc(l.nome)}</strong>
          <span class="checkin-meta">
            ${l.categoria ? `<span class="chip-cat">${esc(l.categoria)}</span>` : ""}
            <span class="chip-codigo">${esc(l.codigo || "—")}</span>
            <span class="checkin-ok">✓ desde ${esc(hora(l.desde)) || "hoje"}</span>
          </span>
        </span>
      </div>
      <div class="checkin-item-acao">
        <button class="btn btn-fantasma btn-sm" data-saida>Registrar saída</button>
      </div>
    </label>`)
    .join("");

  alvo.querySelectorAll("[data-pid]").forEach((row) => {
    row.querySelector("[data-sel]").onchange = (e) => {
      e.target.checked ? selecionadosLista.add(row.dataset.pid) : selecionadosLista.delete(row.dataset.pid);
      sincBarraLista(todos);
    };
    row.querySelector("[data-saida]").onclick = (e) => {
      e.preventDefault();
      registrarSaida(row.dataset.pid, row.querySelector("[data-saida]"));
    };
  });
  sincBarraLista(todos);
}

// só reconstrói a barra de ações (não re-renderiza a lista inteira a cada clique)
function sincBarraLista(todos) {
  const bar = document.getElementById("ga-bar");
  if (!bar) return;
  const sel = [...selecionadosLista].filter((pid) => todos.some((l) => l.pid === pid));
  bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px";
  bar.innerHTML = `
    <button class="btn btn-secundario btn-sm" id="ga-exportar" ${todos.length ? "" : "disabled"}>${icone("baixar")} Exportar CSV</button>
    ${sel.length
      ? `<span class="barra-acoes-cont">${sel.length} selecionado(s)</span>
         <button class="btn btn-perigo btn-sm" id="ga-remover">Remover da atividade</button>
         <button class="btn btn-fantasma btn-sm" id="ga-limpar-sel">Limpar</button>`
      : ""}`;
  bar.querySelector("#ga-exportar").onclick = () => exportarCredenciados(todos);
  const rem = bar.querySelector("#ga-remover");
  if (rem) rem.onclick = () => removerDaAtividade(sel);
  const lim = bar.querySelector("#ga-limpar-sel");
  if (lim) lim.onclick = () => {
    selecionadosLista.clear();
    document.querySelectorAll("#gaveta [data-sel]").forEach((cb) => (cb.checked = false));
    sincBarraLista(todos);
  };
}

function exportarCredenciados(linhas) {
  if (!linhas.length) { toast("Nada para exportar.", "erro"); return; }
  const csv = gerarCSV(linhas, [
    { rotulo: "Nome", valor: (l) => l.nome },
    { rotulo: "Categoria", valor: (l) => l.categoria },
    { rotulo: "Código", valor: (l) => l.codigo },
    { rotulo: "E-mail", valor: (l) => l.email },
    { rotulo: "Empresa", valor: (l) => l.empresa },
    { rotulo: "Entrada em", valor: (l) => (l.desde ? `${formatarData(l.desde)} ${hora(l.desde)}` : "") },
  ]);
  const nomeArq = "atividade-" + (gavetaAtv.nome || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".csv";
  baixarCSV(nomeArq || "atividade.csv", csv);
  toast("Arquivo gerado.", "ok");
}

async function removerDaAtividade(pids) {
  if (!pids.length) return;
  if (!confirmar(`Remover ${pids.length} participante(s) da atividade "${gavetaAtv.nome}"? O histórico de check-in deles nesta atividade será apagado.`)) return;
  try {
    await removerCheckinsAtividade(gavetaAtv.id, pids);
    selecionadosLista.clear();
    checkins = await listCheckins().catch(() => checkins);
    renderGavetaCorpo();
    render();
    toast(`${pids.length} removido(s) da atividade.`, "ok");
  } catch (e) {
    toast(e.message, "erro");
  }
}

function renderAdd() {
  const alvo = document.getElementById("ga-corpo");
  if (!alvo || !gavetaAtv) return;
  const dentro = new Set(credenciadosDe(gavetaAtv.id).map((l) => l.pid));
  const cats = (gavetaAtv.categorias || []).filter(Boolean);
  let fora = participantes.filter((p) => !dentro.has(p.id));
  if (gavetaBusca) {
    fora = fora.filter((p) => `${p.nome} ${p.email || ""} ${p.codigo || ""} ${p.ingresso || ""} ${p.tipo || ""}`.toLowerCase().includes(gavetaBusca));
  }
  fora.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  const lista = fora.slice(0, 80);

  const atalhos = cats.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${cats.map((c) => `<button type="button" class="btn btn-secundario btn-sm" data-cat="${esc(c)}">+ Todos de ${esc(c)}</button>`).join("")}
       </div>`
    : "";

  alvo.innerHTML = `
    <div style="margin-bottom:10px">
      <button type="button" class="btn btn-secundario btn-sm" id="ga-importar">${icone("subir")} Importar lista (Excel/CSV)</button>
    </div>
    ${atalhos}
    <div class="pagina-sub" style="margin:0 0 8px">${fora.length} fora da atividade${fora.length > lista.length ? ` · refine a busca (mostrando ${lista.length})` : ""}</div>
    <div id="ga-add-lista">
      ${lista.map((p) => `<label class="checkin-item" style="padding:9px 12px;cursor:pointer">
        <div class="checkin-item-info" style="flex-direction:row;align-items:center;gap:10px">
          <input type="checkbox" data-add="${p.id}" ${selecionadosAdd.has(p.id) ? "checked" : ""} />
          <span>
            <strong>${esc(p.nome)}</strong>
            <span class="checkin-meta">
              <span class="chip-cat">${esc(p.ingresso || p.tipo || "—")}</span>
              <span class="chip-codigo">${esc(p.codigo || "—")}</span>
            </span>
          </span>
        </div>
      </label>`).join("") || `<p class="pagina-sub" style="margin:0">Todo mundo já está na atividade.</p>`}
    </div>
    <button class="btn btn-primario" id="ga-add-btn" style="margin-top:14px;width:100%">Adicionar selecionados</button>`;

  alvo.querySelectorAll("[data-add]").forEach((cb) => {
    cb.onchange = () => {
      cb.checked ? selecionadosAdd.add(cb.dataset.add) : selecionadosAdd.delete(cb.dataset.add);
      atualizarBotaoAdd();
    };
  });
  alvo.querySelectorAll("[data-cat]").forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.cat;
      participantes.forEach((p) => { if (!dentro.has(p.id) && (p.ingresso || p.tipo) === c) selecionadosAdd.add(p.id); });
      renderAdd();
    };
  });
  document.getElementById("ga-add-btn").onclick = adicionarSelecionados;
  document.getElementById("ga-importar").onclick = () => modalImportarAtv();
  atualizarBotaoAdd();
}

const ALIAS_ATV = {
  "nome completo": "nome", "e-mail": "email", email: "email", whatsapp: "telefone",
  celular: "telefone", fone: "telefone", telefone: "telefone", empresa: "empresa",
  categoria: "categoria", ingresso: "categoria", "tipo de ingresso": "categoria",
  codigo: "codigo", "codigo do participante": "codigo", "cod": "codigo",
};

const norm = (s) => String(s || "").trim().toLowerCase();

function modalImportarAtv() {
  abrirModal({
    titulo: `Importar participantes — ${gavetaAtv.nome}`,
    textoConfirmar: "Importar",
    corpoHtml: `
      <p class="pagina-sub" style="margin:0 0 10px">
        Cole a tabela (Excel/Sheets) ou selecione um CSV. Colunas: <b>nome</b>
        (obrigatória), <b>email</b>, <b>codigo</b>, categoria, empresa, telefone.
        Cada linha é casada com um participante do evento por <b>e-mail</b>,
        <b>código</b> ou <b>nome</b>. Quem não existir é cadastrado como Convidado
        e entra na atividade.
      </p>
      <label class="campo"><span>Colar tabela</span>
        <textarea class="input" name="texto" rows="7" placeholder="nome;email;codigo"></textarea></label>
      <label class="campo"><span>…ou arquivo CSV</span>
        <input class="input" type="file" name="arquivo" accept=".csv,.txt,.tsv" /></label>`,
    aoMontar: (root) => {
      const arq = root.querySelector('[name="arquivo"]');
      arq.onchange = () => {
        const f = arq.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { root.querySelector('[name="texto"]').value = r.result; };
        r.readAsText(f, "utf-8");
      };
    },
    onConfirmar: async (form) => {
      const linhas = parsearTabela(form.querySelector('[name="texto"]').value, ALIAS_ATV)
        .filter((l) => (l.nome || l.email || l.codigo || "").trim());
      if (!linhas.length) { toast("Nenhuma linha válida.", "erro"); return false; }

      const porEmail = new Map(participantes.filter((p) => p.email).map((p) => [norm(p.email), p]));
      const porCodigo = new Map(participantes.filter((p) => p.codigo).map((p) => [norm(p.codigo), p]));
      const porNome = new Map(participantes.map((p) => [norm(p.nome), p]));
      const dentro = new Set(credenciadosDe(gavetaAtv.id).map((l) => l.pid));

      const paraEntrar = new Set();
      const novos = [];
      let jaEstavam = 0;

      for (const l of linhas) {
        const achado =
          (l.email && porEmail.get(norm(l.email))) ||
          (l.codigo && porCodigo.get(norm(l.codigo))) ||
          (l.nome && porNome.get(norm(l.nome)));
        if (achado) {
          if (dentro.has(achado.id)) jaEstavam++;
          else paraEntrar.add(achado.id);
        } else if ((l.nome || "").trim()) {
          novos.push({
            nome: l.nome.trim(),
            email: (l.email || "").trim() || null,
            telefone: (l.telefone || "").trim() || null,
            empresa: (l.empresa || "").trim() || null,
            tipo: "Convidado",
            pagamento: "Convidado",
            ingresso: (l.categoria || "").trim() || null,
          });
        }
      }

      let criados = [];
      if (novos.length) criados = await inserirLote("participantes", novos);
      const idsEntrada = [...paraEntrar, ...criados.map((p) => p.id)];
      if (idsEntrada.length) {
        await inserirLote("checkins", idsEntrada.map((id) => ({
          participante_id: id, acao: "entrada", origem: "atividades-import", atividade_id: gavetaAtv.id,
        })));
      }

      [atividades, checkins, participantes] = await Promise.all([
        listAtividades(), listCheckins().catch(() => checkins), listParticipantes().catch(() => participantes),
      ]);
      gavetaModo = "lista";
      const g = document.getElementById("gaveta");
      g?.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x.dataset.aba === "lista"));
      renderGavetaCorpo();
      render();

      const partes = [`${idsEntrada.length} adicionado(s)`];
      if (criados.length) partes.push(`${criados.length} novo(s) cadastro(s)`);
      if (jaEstavam) partes.push(`${jaEstavam} já estava(m)`);
      toast(partes.join(" · "), "ok");
    },
  });
}

function atualizarBotaoAdd() {
  const btn = document.getElementById("ga-add-btn");
  if (!btn) return;
  const n = selecionadosAdd.size;
  btn.textContent = n ? `Adicionar ${n} à atividade` : "Adicionar selecionados";
  btn.disabled = !n;
}

async function adicionarSelecionados() {
  const ids = [...selecionadosAdd];
  if (!ids.length) return;
  const btn = document.getElementById("ga-add-btn");
  btn.disabled = true;
  try {
    await inserirLote("checkins", ids.map((id) => ({
      participante_id: id, acao: "entrada", origem: "atividades", atividade_id: gavetaAtv.id,
    })));
    selecionadosAdd.clear();
    checkins = await listCheckins().catch(() => checkins);
    gavetaModo = "lista";
    const g = document.getElementById("gaveta");
    g?.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x.dataset.aba === "lista"));
    renderGavetaCorpo();
    render();
    toast(`${ids.length} participante(s) adicionado(s).`, "ok");
  } catch (e) {
    btn.disabled = false;
    toast(e.message, "erro");
  }
}

async function registrarSaida(pid, btn) {
  btn.disabled = true;
  try {
    await registrarCheckin(pid, "saida", "atividades", gavetaAtv.id);
    checkins = await listCheckins().catch(() => checkins);
    renderGavetaCorpo();
    render();
    toast("Saída registrada.", "ok");
  } catch (e) {
    btn.disabled = false;
    toast(e.message, "erro");
  }
}
