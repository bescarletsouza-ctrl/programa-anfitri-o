// =============================================================================
// Gestão de convidados — tabela, filtros, pills, gaveta de decisão.
// =============================================================================
import {
  iniciarPagina, esc, debounce, formatarData, telParaWhatsApp,
  abrirModal, abrirGaveta, fecharGaveta, toast, confirmar,
} from "./ui.js";
import {
  listGrupos, listAnfitrioes, listConvidados, listFormPerguntas, salvar, remover,
} from "./supabase.js";
import { STATUS_CONVIDADO } from "./config.js";

iniciarPagina("convidados");
const el = (id) => document.getElementById(id);

let grupos = [], anfitrioes = [], lista = [], perguntas = [];
const filtros = { busca: "", status: "", grupo: "" };

carregar();

async function carregar() {
  try {
    [grupos, anfitrioes, lista, perguntas] = await Promise.all([
      listGrupos(), listAnfitrioes(), listConvidados(), listFormPerguntas(),
    ]);
    el("f-status").innerHTML = `<option value="">Todos os status</option>` +
      STATUS_CONVIDADO.map((s) => `<option>${s}</option>`).join("");
    el("f-grupo").innerHTML = `<option value="">Todos os grupos</option>` +
      grupos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join("");
    el("carregando").hidden = true;
    render();
  } catch (e) {
    el("carregando").textContent = "Erro ao carregar: " + e.message;
  }
}

el("busca").addEventListener("input", debounce((e) => { filtros.busca = e.target.value.toLowerCase(); render(); }, 200));
el("f-status").addEventListener("change", (e) => { filtros.status = e.target.value; render(); });
el("f-grupo").addEventListener("change", (e) => { filtros.grupo = e.target.value; render(); });
el("btn-novo").onclick = modalNovo;

const badgeStatus = (s) =>
  ({ Pendente: "badge-alerta", Aprovado: "badge-info", Recusado: "badge-erro", Confirmado: "badge-ok" }[s] || "badge-neutro");

function filtrar() {
  return lista.filter((c) => {
    if (filtros.status && c.status !== filtros.status) return false;
    if (filtros.grupo && c.anfitriao?.grupo_id !== filtros.grupo) return false;
    if (filtros.busca) {
      const alvo = `${c.nome || ""} ${c.email || ""} ${c.empresa || ""}`.toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

function render() {
  const filtrada = filtrar();

  const cont = (s) => lista.filter((c) => c.status === s).length;
  el("pills").innerHTML = STATUS_CONVIDADO.map(
    (s) => `<div class="card" style="box-shadow:none;padding:14px">
      <div class="kpi"><span class="valor">${cont(s)}</span>
      <span class="rotulo"><span class="badge ${badgeStatus(s)}">${s}</span></span></div></div>`
  ).join("");

  const vazio = filtrada.length === 0;
  el("wrap").hidden = vazio;
  el("vazio").hidden = !vazio;
  if (vazio) return;

  el("linhas").innerHTML = filtrada
    .map((c) => {
      const wa = telParaWhatsApp(c.telefone);
      return `<tr data-id="${c.id}">
        <td><strong>${esc(c.nome || "—")}</strong><div class="pagina-sub" style="margin:0;font-size:.75rem">${esc(c.email || "")}</div></td>
        <td>${esc(c.empresa || "—")}</td>
        <td>${esc(c.anfitriao?.nome || "—")}</td>
        <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(c.telefone)}</a>` : "—"}</td>
        <td><span class="badge ${badgeStatus(c.status)}">${esc(c.status)}</span></td>
        <td>${formatarData(c.created_at)}</td>
      </tr>`;
    })
    .join("");
  el("linhas").querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => abrirGavetaDetalhe(tr.dataset.id);
  });
}

/* ---- Novo convidado (manual) ---- */
function modalNovo() {
  if (!anfitrioes.length) {
    toast("Cadastre um anfitrião antes.", "erro");
    return;
  }
  abrirModal({
    titulo: "Novo convidado",
    textoConfirmar: "Criar",
    corpoHtml: `
      <label class="campo"><span>Anfitrião *</span>
        <select class="select" name="anfitriao_id" required>
          ${anfitrioes.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Nome *</span><input class="input" name="nome" required /></label>
      <label class="campo"><span>E-mail</span><input class="input" name="email" type="email" /></label>
      <label class="campo"><span>Telefone</span><input class="input" name="telefone" /></label>
      <label class="campo"><span>Empresa</span><input class="input" name="empresa" /></label>
      <label class="campo"><span>CNPJ</span><input class="input" name="cnpj" /></label>
      <label class="campo"><span>Site</span><input class="input" name="site" /></label>
      ${campoSelecao("faturamento", "Faturamento mensal")}
      ${campoSelecao("funcionarios", "Nº de funcionários")}`,
    onConfirmar: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      Object.keys(f).forEach((k) => { if (f[k] === "") f[k] = null; });
      await salvar("convidados", { ...f, status: "Pendente" });
      toast("Convidado criado.", "ok");
      lista = await listConvidados();
      render();
    },
  });
}

function campoSelecao(chave, rotulo) {
  const p = perguntas.find((x) => x.chave === chave);
  const opts = (p?.opcoes || []).map((o) => `<option>${esc(o)}</option>`).join("");
  return `<label class="campo"><span>${esc(rotulo)}</span>
    <select class="select" name="${chave}"><option value="">—</option>${opts}</select></label>`;
}

/* ---- Gaveta de detalhe ---- */
function abrirGavetaDetalhe(id) {
  const c = lista.find((x) => x.id === id);
  if (!c) return;
  const extras = perguntas.filter((p) => !p.sistema && c.respostas && c.respostas[p.chave] != null);

  abrirGaveta(
    `${esc(c.nome || "Convidado")}`,
    `
    <div class="secao">
      <h4>Decisão</h4>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-primario" id="d-aprovar" style="flex:1;justify-content:center;background:var(--ok)"
          ${c.status === "Aprovado" || c.status === "Confirmado" ? "disabled" : ""}>✓ Aprovar</button>
        <button class="btn btn-perigo" id="d-reprovar" style="flex:1;justify-content:center"
          ${c.status === "Recusado" ? "disabled" : ""}>✕ Reprovar</button>
      </div>
      <select class="select" id="d-status">
        ${STATUS_CONVIDADO.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <p class="pagina-sub" style="margin:6px 0 0;font-size:.72rem">
        Status atual: <b>${esc(c.status)}</b> — o convidado vê isso na página de acompanhamento.
      </p>
    </div>

    <div class="secao">
      <h4>Contato</h4>
      <p style="margin:4px 0">${esc(c.email || "—")}</p>
      <p style="margin:4px 0">${
        telParaWhatsApp(c.telefone)
          ? `<a href="${telParaWhatsApp(c.telefone)}" target="_blank" rel="noopener">${esc(c.telefone)}</a>`
          : "—"
      }</p>
      <p style="margin:4px 0" class="pagina-sub">Convidado por ${esc(c.anfitriao?.nome || "—")}</p>
    </div>

    <div class="secao">
      <h4>Empresa</h4>
      ${infoLinha("Empresa", c.empresa)}
      ${infoLinha("CNPJ", c.cnpj)}
      ${infoLinha("Faturamento", c.faturamento)}
      ${infoLinha("Funcionários", c.funcionarios)}
      ${infoLinha("Site", c.site)}
    </div>

    ${
      extras.length
        ? `<div class="secao"><h4>Outras respostas</h4>${extras
            .map((p) => infoLinha(p.rotulo, c.respostas[p.chave]))
            .join("")}</div>`
        : ""
    }

    <div class="secao">
      <h4>Observação interna</h4>
      <textarea class="input" id="d-obs" rows="3">${esc(c.observacao || "")}</textarea>
      <button class="btn btn-primario" id="d-salvar" style="margin-top:10px">Salvar</button>
    </div>

    <div class="secao">
      <p class="pagina-sub" style="margin:0;font-size:.75rem">Recebido em ${formatarData(c.created_at, true)}</p>
    </div>

    <div class="secao zona-perigo">
      <p>Use apenas para registros de teste.</p>
      <button class="btn btn-perigo" id="d-excluir">Excluir convidado</button>
    </div>`
  );

  const g = document.getElementById("gaveta");
  const salvarConvidado = async (patch, msg) => {
    try {
      await salvar("convidados", { id: c.id, ...patch });
      toast(msg, "ok");
      lista = await listConvidados();
      render();
    } catch (e) {
      toast(e.message, "erro");
    }
  };
  g.querySelector("#d-status").onchange = (e) =>
    salvarConvidado({ status: e.target.value }, "Status atualizado.");
  g.querySelector("#d-aprovar").onclick = () =>
    salvarConvidado({ status: "Aprovado" }, "Convidado aprovado.").then(fecharGaveta);
  g.querySelector("#d-reprovar").onclick = () =>
    salvarConvidado({ status: "Recusado" }, "Convidado reprovado.").then(fecharGaveta);
  g.querySelector("#d-salvar").onclick = () =>
    salvarConvidado({ observacao: g.querySelector("#d-obs").value.trim() || null }, "Observação salva.").then(fecharGaveta);
  g.querySelector("#d-excluir").onclick = async () => {
    if (!confirmar("Excluir este convidado?")) return;
    try {
      await remover("convidados", c.id);
      toast("Convidado excluído.", "ok");
      fecharGaveta();
      lista = await listConvidados();
      render();
    } catch (e) {
      toast(e.message, "erro");
    }
  };
}

function infoLinha(rotulo, valor) {
  return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--cinza-100)">
    <span class="pagina-sub" style="margin:0">${esc(rotulo)}</span>
    <span style="font-size:.88rem;text-align:right">${esc(valor || "—")}</span></div>`;
}
