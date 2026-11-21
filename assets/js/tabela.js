// =============================================================================
// Utilidades de tabela: ler Excel (.xlsx) ou tabela colada (Excel/Sheets), e
// gerar/baixar planilhas .xlsx. Usa a biblioteca SheetJS via esm.sh — só é
// carregada quando alguma dessas funções é realmente chamada.
// =============================================================================

let _xlsxPromise = null;
function xlsxLib() {
  if (!_xlsxPromise) _xlsxPromise = import("https://esm.sh/xlsx@0.18.5");
  return _xlsxPromise;
}

export function normalizarCab(h) {
  return String(h || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// texto: conteúdo colado (Ctrl+V de Excel/Sheets — vem separado por tab).
// alias: { "cabecalho normalizado": "chave desejada" } (opcional).
// Retorna array de objetos { chave: valor }. Detecta delimitador , ; ou tab.
export function parsearTabela(texto, alias = {}) {
  const linhas = String(texto || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const p = linhas[0];
  const delim = p.includes("\t") ? "\t"
    : (p.split(";").length > p.split(",").length ? ";" : ",");

  const parseLinha = (l) => {
    const out = []; let cur = "", dentro = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (dentro && l[i + 1] === '"') { cur += '"'; i++; }
        else dentro = !dentro;
      } else if (c === delim && !dentro) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const cab = parseLinha(linhas[0]).map((h) => {
    const n = normalizarCab(h);
    return alias[n] || n;
  });
  return linhas.slice(1).map((l) => {
    const cols = parseLinha(l);
    const o = {};
    cab.forEach((h, i) => (o[h] = (cols[i] || "").trim()));
    return o;
  });
}

// arquivo: File (.xlsx/.xls) escolhido pelo usuário. alias: igual parsearTabela.
// Retorna no mesmo formato de parsearTabela — array de objetos { chave: valor }.
export async function lerXlsx(arquivo, alias = {}) {
  const XLSX = await xlsxLib();
  const buf = await arquivo.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const planilha = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(planilha, { header: 1, defval: "", raw: false });
  if (linhas.length < 2) return [];
  const cab = linhas[0].map((h) => {
    const n = normalizarCab(h);
    return alias[n] || n;
  });
  return linhas.slice(1)
    .filter((cols) => cols.some((v) => String(v ?? "").trim()))
    .map((cols) => {
      const o = {};
      cab.forEach((h, i) => (o[h] = String(cols[i] ?? "").trim()));
      return o;
    });
}

// colunas: [{ chave, rotulo }] ou [{ valor: fn, rotulo }]. linhas: array de objetos.
// Gera e baixa um .xlsx com uma aba "Dados".
export async function baixarXLSX(nomeArquivo, linhas, colunas) {
  const XLSX = await xlsxLib();
  const dados = linhas.map((l) => {
    const o = {};
    colunas.forEach((c) => {
      o[c.rotulo] = typeof c.valor === "function" ? c.valor(l) : (l[c.chave] ?? "");
    });
    return o;
  });
  const planilha = XLSX.utils.json_to_sheet(dados);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Dados");
  baixarLivro(XLSX, livro, nomeArquivo);
}

// Colunas dos CAMPOS ADICIONAIS (participantes.campos_extra) para o Excel.
// Entram: todo campo ativo, os desativados que tenham resposta e as respostas de chaves que já não existem
// (nada se perde). `usados` = rótulos que já existem no arquivo (se repetir, ganha " (campo adicional)").
export function colunasCamposExtras(registros, definicoes = [], usados = []) {
  const IGNORAR = new Set(["tipo_outro"]);   // já sai na coluna "Tipo (qual)"
  const tem = (chave) => registros.some((r) => {
    const v = r.campos_extra?.[chave];
    return v != null && v !== "" && !(Array.isArray(v) && !v.length);
  });
  const ativos = definicoes.filter((c) => c.ativo && !IGNORAR.has(c.chave));
  const inativos = definicoes.filter((c) => !c.ativo && !IGNORAR.has(c.chave) && tem(c.chave));
  const conhecidas = new Set(definicoes.map((c) => c.chave));
  const orfas = [...new Set(registros.flatMap((r) => Object.keys(r.campos_extra || {})))]
    .filter((k) => !conhecidas.has(k) && !IGNORAR.has(k) && tem(k))
    .map((k) => ({ chave: k, nome: k }));
  const ocupados = new Set(usados);
  return [...ativos, ...inativos, ...orfas].map((c) => {
    let rotulo = c.nome || c.chave;
    if (ocupados.has(rotulo)) rotulo = `${rotulo} (campo adicional)`;
    ocupados.add(rotulo);
    return {
      rotulo,
      valor: (r) => {
        const v = r.campos_extra?.[c.chave];
        return v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v;
      },
    };
  });
}

// linhasAoA: array de arrays, a primeira é o cabeçalho — usado para o link
// "baixar modelo" dos formulários de importação.
export async function baixarModeloXLSX(nomeArquivo, linhasAoA) {
  const XLSX = await xlsxLib();
  const planilha = XLSX.utils.aoa_to_sheet(linhasAoA);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Modelo");
  baixarLivro(XLSX, livro, nomeArquivo);
}

function baixarLivro(XLSX, livro, nomeArquivo) {
  const bin = XLSX.write(livro, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bin], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
