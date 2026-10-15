// =============================================================================
// Prazo (SLA) por etapa do pipeline: quanto tempo um card pode ficar numa
// etapa. Passou do prazo → amarelo; passou do limite crítico → vermelho
// (por padrão o dobro do prazo). Conta horas corridas desde que o card entrou
// na etapa (última movimentação; sem movimentação registrada, desde o cadastro).
// =============================================================================

// etapa: { sla_horas, sla_critico_horas } · desdeISO: quando entrou na etapa
// Devolve null se a etapa não tem prazo (ou falta a data de entrada).
export function avaliarPrazo(etapa, desdeISO, agora = Date.now()) {
  const prazo = Number(etapa?.sla_horas);
  if (!(prazo > 0) || !desdeISO) return null;
  const t = new Date(desdeISO).getTime();
  if (isNaN(t)) return null;
  const crit = Number(etapa?.sla_critico_horas);
  const critico = crit > prazo ? crit : prazo * 2;
  const horas = Math.max(0, (agora - t) / 3600000);
  const nivel = horas >= critico ? "vermelho" : horas > prazo ? "amarelo" : "ok";
  return { nivel, horas, prazo, critico };
}

// 0,4h → "24min" · 5,5h → "5h30" · 26h → "26h" · 50h → "2d 2h"
export function fmtDuracao(horas) {
  if (!isFinite(horas) || horas < 0) return "—";
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

export const ROTULO_NIVEL = { ok: "No prazo", amarelo: "Atenção", vermelho: "Atrasado" };

// texto curto pro card: "⏱ 26h · prazo 24h"
export function textoPrazo(r) {
  return r ? `⏱ ${fmtDuracao(r.horas)} · prazo ${fmtDuracao(r.prazo)}` : "";
}

// conta cards por nível pro cabeçalho da coluna
export function resumirPrazos(resultados) {
  const c = { ok: 0, amarelo: 0, vermelho: 0 };
  resultados.forEach((r) => { if (r) c[r.nivel]++; });
  return c;
}
