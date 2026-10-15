// =============================================================================
// Prazo (SLA) por etapa do pipeline: quanto tempo um card pode ficar numa
// etapa. Passou do prazo → amarelo; passou do limite crítico → vermelho
// (por padrão o dobro do prazo). Conta horas corridas desde o dia e a hora em
// que o card ENTROU na etapa atual (movimentação registrada) — nunca desde o
// cadastro no sistema. Sem data de entrada conhecida, não chuta: "sem-data".
// =============================================================================

// etapa: { sla_horas, sla_critico_horas } · entrouISO: quando entrou na etapa
// Devolve null se a etapa não tem prazo. Sem data de entrada → nivel "sem-data".
export function avaliarPrazo(etapa, entrouISO, agora = Date.now()) {
  const prazo = Number(etapa?.sla_horas);
  if (!(prazo > 0)) return null;
  const crit = Number(etapa?.sla_critico_horas);
  const critico = crit > prazo ? crit : prazo * 2;
  const t = entrouISO ? new Date(entrouISO).getTime() : NaN;
  if (isNaN(t)) return { nivel: "sem-data", horas: null, prazo, critico };
  const horas = Math.max(0, (agora - t) / 3600000);
  const nivel = horas >= critico ? "vermelho" : horas > prazo ? "amarelo" : "ok";
  return { nivel, horas, prazo, critico };
}

// 0,4h → "24min" · 5,5h → "5h30" · 26h → "26h" · 50h → "2d 2h"
export function fmtDuracao(horas) {
  if (typeof horas !== "number" || !isFinite(horas) || horas < 0) return "—";
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 10) {
    const h = Math.floor(horas), m = Math.round((horas - h) * 60);
    if (m === 0) return `${h}h`;
    if (m === 60) return `${h + 1}h`;
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  if (horas < 48) return `${Math.floor(horas)}h`;
  const d = Math.floor(horas / 24), h = Math.floor(horas % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export const ROTULO_NIVEL = { ok: "No prazo", amarelo: "Atenção", vermelho: "Atrasado", "sem-data": "Sem data de entrada" };

// texto curto pro card: "⏱ 26h · prazo 24h" / "⏱ sem data de entrada"
// (r.estimada: a data de entrada foi reconstruída, não registrada → "~26h")
export function textoPrazo(r) {
  if (!r) return "";
  if (r.nivel === "sem-data") return "⏱ sem data de entrada";
  return `⏱ ${r.estimada ? "~" : ""}${fmtDuracao(r.horas)} · prazo ${fmtDuracao(r.prazo)}`;
}

// conta cards por nível pro cabeçalho da coluna
export function resumirPrazos(resultados) {
  const c = { ok: 0, amarelo: 0, vermelho: 0, "sem-data": 0 };
  resultados.forEach((r) => { if (r) c[r.nivel]++; });
  return c;
}
