// =============================================================================
// Utilidades de tabela: ler CSV/TSV colado (do Excel/Sheets) e gerar/baixar CSV.
// =============================================================================

export function normalizarCab(h) {
  return String(h || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// texto: conteúdo colado ou lido de arquivo.
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

// colunas: [{ chave, rotulo }]. linhas: array de objetos.
export function gerarCSV(linhas, colunas) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cab = colunas.map((c) => esc(c.rotulo)).join(";");
  const corpo = linhas
    .map((l) => colunas.map((c) => esc(typeof c.valor === "function" ? c.valor(l) : l[c.chave])).join(";"))
    .join("\n");
  return "﻿" + cab + "\n" + corpo; // BOM p/ o Excel abrir acentos certos
}

export function baixarCSV(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
