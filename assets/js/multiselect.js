// =============================================================================
// Seleção múltipla para filtros.
//
//   const ms = multiSelect(document.getElementById("f-tipo"));
//
// Transforma um <select> existente num seletor com caixinhas, SEM mexer no resto
// do código da tela:
//  - o <select> original continua sendo a fonte das opções (fica escondido); a
//    opção com value="" é o texto de "nada filtrado" (ex.: "Todos os tipos");
//  - se o código troca as <option> (innerHTML), a lista se atualiza sozinha e a
//    seleção é mantida para o que ainda existir;
//  - select.valores  → array dos valores marcados ([] = sem filtro);
//  - select.value    → (leitura) 1º valor marcado ou ""; (escrita) marca só esse
//                      valor — "" limpa. Código antigo que faz `.value = ""` pra
//                      limpar continua funcionando;
//  - dispara "change" no <select> a cada alteração do usuário.
// =============================================================================

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// valores selecionados de um <select> (multi ou comum) — string[]
export const valoresDe = (sel) => (sel?.valores ? [...sel.valores] : sel?.value ? [sel.value] : []);

// o item passa no filtro? (filtro vazio = passa)
export const casa = (filtro, valor) => !filtro || !filtro.length || filtro.includes(valor);

export function multiSelect(sel) {
  if (!sel || sel.__ms) return sel?.__ms || null;

  let marcados = new Set();
  let painel = null;
  const wrap = document.createElement("div");
  wrap.className = "ms";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "select ms-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  wrap.appendChild(btn);
  sel.insertAdjacentElement("afterend", wrap);
  sel.style.display = "none";

  const opcoes = () => [...sel.options].map((o) => ({ valor: o.value, rotulo: o.textContent.trim() }));
  const itens = () => opcoes().filter((o) => o.valor !== "");
  const rotuloTodos = () => opcoes().find((o) => o.valor === "")?.rotulo || "Todos";

  function desenhaBotao() {
    const todos = itens();
    // descarta o que não existe mais nas opções
    marcados = new Set([...marcados].filter((v) => todos.some((o) => o.valor === v)));
    const nomes = todos.filter((o) => marcados.has(o.valor)).map((o) => o.rotulo);
    let texto = rotuloTodos();
    if (nomes.length === 1) texto = nomes[0];
    else if (nomes.length > 1) texto = `${nomes[0]} +${nomes.length - 1}`;
    btn.innerHTML = `<span class="ms-txt">${esc(texto)}</span>${nomes.length > 1 ? `<span class="ms-n">${nomes.length}</span>` : ""}`;
    btn.title = nomes.length > 1 ? nomes.join(", ") : "";
    btn.classList.toggle("ms-ativo", nomes.length > 0);
  }

  function mudou() {
    desenhaBotao();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fechar() {
    if (!painel) return;
    painel.remove();
    painel = null;
    document.removeEventListener("click", foraClick, true);
    document.removeEventListener("keydown", tecla, true);
    window.removeEventListener("resize", fechar);
    btn.setAttribute("aria-expanded", "false");
  }
  const foraClick = (e) => { if (painel && !painel.contains(e.target) && !btn.contains(e.target)) fechar(); };
  const tecla = (e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); btn.focus(); } };

  function posiciona() {
    const r = btn.getBoundingClientRect();
    painel.style.minWidth = Math.max(r.width, 200) + "px";
    let left = r.left + window.scrollX;
    left = Math.min(left, window.scrollX + document.documentElement.clientWidth - painel.offsetWidth - 8);
    painel.style.left = Math.max(window.scrollX + 8, left) + "px";
    let top = r.bottom + window.scrollY + 4;
    if (r.bottom + painel.offsetHeight + 8 > window.innerHeight && r.top > painel.offsetHeight + 8) {
      top = r.top + window.scrollY - painel.offsetHeight - 4;
    }
    painel.style.top = top + "px";
  }

  function abrir() {
    if (painel) { fechar(); return; }
    document.querySelectorAll(".ms-painel").forEach((p) => p.remove());
    const todos = itens();
    painel = document.createElement("div");
    painel.className = "ms-painel";
    painel.setAttribute("role", "listbox");
    painel.setAttribute("aria-multiselectable", "true");
    const comBusca = todos.length > 8;
    painel.innerHTML = `
      ${comBusca ? `<input class="input ms-busca" type="search" placeholder="Buscar…" aria-label="Buscar opção" />` : ""}
      <div class="ms-lista">${todos.map((o) => `
        <label class="ms-op" data-v="${esc(o.valor)}">
          <input type="checkbox" value="${esc(o.valor)}" ${marcados.has(o.valor) ? "checked" : ""} />
          <span>${esc(o.rotulo)}</span>
        </label>`).join("") || `<div class="ms-vazio">Nenhuma opção.</div>`}</div>
      <div class="ms-rodape">
        <button type="button" class="btn btn-fantasma btn-sm" data-limpar>Limpar</button>
        <button type="button" class="btn btn-primario btn-sm" data-ok>Pronto</button>
      </div>`;
    document.body.appendChild(painel);
    btn.setAttribute("aria-expanded", "true");

    painel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.onchange = () => { cb.checked ? marcados.add(cb.value) : marcados.delete(cb.value); mudou(); };
    });
    painel.querySelector("[data-limpar]").onclick = () => {
      marcados.clear();
      painel.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
      mudou();
    };
    painel.querySelector("[data-ok]").onclick = () => { fechar(); btn.focus(); };
    const busca = painel.querySelector(".ms-busca");
    if (busca) {
      busca.oninput = () => {
        const q = busca.value.trim().toLowerCase();
        painel.querySelectorAll(".ms-op").forEach((l) => {
          l.hidden = !!q && !l.textContent.toLowerCase().includes(q);
        });
      };
      busca.focus();
    }
    posiciona();
    setTimeout(() => {
      document.addEventListener("click", foraClick, true);
      document.addEventListener("keydown", tecla, true);
      window.addEventListener("resize", fechar);
    }, 0);
  }
  btn.onclick = abrir;

  // as opções foram trocadas pelo código da tela → redesenha mantendo a seleção
  const obs = new MutationObserver(() => { desenhaBotao(); });
  obs.observe(sel, { childList: true, subtree: true });

  // API no próprio <select>
  Object.defineProperty(sel, "valores", {
    configurable: true,
    get: () => [...marcados],
    set: (arr) => { marcados = new Set((arr || []).map(String)); desenhaBotao(); },
  });
  Object.defineProperty(sel, "value", {
    configurable: true,
    get: () => [...marcados][0] || "",
    set: (v) => { marcados = v ? new Set([String(v)]) : new Set(); desenhaBotao(); },
  });

  const api = { atualizar: desenhaBotao, limpar: () => { marcados.clear(); desenhaBotao(); }, fechar, wrap };
  sel.__ms = api;
  desenhaBotao();
  return api;
}

// vários de uma vez: multiSelects(["f-tipo", "f-situacao"]) ou (document.querySelectorAll(...))
export function multiSelects(lista) {
  [...lista].forEach((x) => multiSelect(typeof x === "string" ? document.getElementById(x) : x));
}
