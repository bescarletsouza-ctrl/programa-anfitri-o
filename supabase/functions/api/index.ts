// @ts-nocheck
// =============================================================================
// Edge Function: api  —  API de LEITURA (somente GET) da plataforma.
//
//   GET /api/v1/eventos        (Vercel reescreve pra cá — ver vercel.json)
//   GET /api/v1/participantes
//
// Auth: "Authorization: Bearer wev_…". O token é um segredo de somente-leitura;
// no banco fica só o hash (SHA-256). Gerar/revogar: funções criar_api_token() e
// revogar_api_token() (migração 0036) — sem mexer em código.
//
// Escopo do token: uma organização (todos os eventos dela) ou a plataforma
// inteira (só quem roda o SQL Editor consegue criar esse).
//
// Limite: 60 req/min por token (API_LIMITE_POR_MINUTO) → 429 + Retry-After.
// Todo acesso vai pra api_log.
//
// Arquivo único e sem tipos de propósito: dá pra colar direto no editor do
// Supabase e os testes (api_test.ts) rodam em Deno ou no navegador.
//
// Deploy:  supabase functions deploy api --no-verify-jwt
//          (ou colar no editor e deixar "Verify JWT" DESLIGADO)
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

export const LIMITE_MAX = 500;
export const LIMITE_POR_MINUTO = 60;
const STATUS_EVENTO = ["ativo", "encerrado", "inativo"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = "America/Sao_Paulo";

/* ---- utilidades puras (testadas em api_test.ts) --------------------------- */

// ISO 8601 com o fuso de Brasília: 2026-10-15T14:30:00-03:00
export function isoSP(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  if (isNaN(d)) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((comoUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const abs = Math.abs(off);
  const dois = (n) => String(n).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? "-" : "+"}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`;
}

// data do evento (sem hora) → meia-noite de Brasília
export function dataParaISO(dataStr) {
  if (!dataStr) return null;
  return isoSP(new Date(`${String(dataStr).slice(0, 10)}T03:00:00Z`));
}

export function codificarCursor(ts, id) {
  return btoa(JSON.stringify({ t: ts, i: id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodificarCursor(s) {
  try {
    const b = String(s).replace(/-/g, "+").replace(/_/g, "/");
    const o = JSON.parse(atob(b + "=".repeat((4 - (b.length % 4)) % 4)));
    if (typeof o?.t === "string" && !isNaN(Date.parse(o.t)) && UUID_RE.test(o?.i || "")) return { t: o.t, i: o.i };
  } catch { /* cai no null */ }
  return null;
}

// "R$ 1.500,00" → 1500 ; "Gratuito"/vazio → null ; "500" → 500
export function parsePreco(texto) {
  const s = String(texto ?? "").trim();
  if (!s || /gratuit|free|cortesia/i.test(s)) return null;
  const m = s.match(/\d[\d.,]*/);
  if (!m) return null;
  let n = m[0];
  if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, "");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// valor de TABELA do ingresso (tipos_ingresso.preco) × quantidade — só pra quem
// pagou: pagamento "Pago", ou "Externo" (gateway) já Confirmado. Não é o valor
// que passou no gateway.
export function valorPago({ pagamento, situacao, preco_ingresso, quantidade }) {
  const pagou = pagamento === "Pago" || (pagamento === "Externo" && situacao === "Confirmado");
  if (!pagou) return null;
  const unit = parsePreco(preco_ingresso);
  if (unit == null) return null;
  return Math.round(unit * Math.max(Number(quantidade) || 1, 1) * 100) / 100;
}

// inscrito | aprovado | reprovado | cancelado | lista de espera
export function statusInscricao({ pagamento, situacao, convidado_status }) {
  if (pagamento === "Cancelado" || pagamento === "Reembolsado" || situacao === "Desativado") return "cancelado";
  if (situacao === "Fila de espera") return "lista de espera";
  if (convidado_status === "Recusado") return "reprovado";
  if (convidado_status === "Aprovado" || convidado_status === "Confirmado") return "aprovado";
  if (convidado_status === "Pendente") return "inscrito";
  return situacao === "Confirmado" ? "aprovado" : "inscrito";
}

export function formatarEvento(r) {
  return {
    id: r.id,
    nome: r.nome,
    data_inicio: dataParaISO(r.data_evento),
    data_fim: null, // a plataforma guarda só a data de início
    status: r.status,
    local: r.local ?? null,
    criado_em: isoSP(r.criado_em),
    atualizado_em: isoSP(r.atualizado_em),
  };
}

export function formatarParticipante(r) {
  return {
    id: r.id,
    evento_id: r.evento_id,
    evento_nome: r.evento_nome,
    tipo: r.tipo ?? null,
    nome: r.nome,
    email: r.email ?? null,
    telefone: r.telefone ?? null,
    tipo_ingresso: r.ingresso ?? null,
    valor_pago: valorPago(r),
    pagamento: r.pagamento ?? null,
    status_inscricao: statusInscricao(r),
    checkin: !!r.presente,
    checkin_em: isoSP(r.checkin_at),
    utm_source: r.utm_source ?? null,
    utm_medium: r.utm_medium ?? null,
    utm_campaign: r.utm_campaign ?? null,
    criado_em: isoSP(r.criado_em),
    atualizado_em: isoSP(r.atualizado_em),
  };
}

async function sha256hex(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---- camada de dados (trocada por um fake nos testes) --------------------- */

export function criarDados(sb) {
  const rpc = async (nome, args) => {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message);
    return data || [];
  };
  return {
    async buscarToken(hash) {
      const { data, error } = await sb.from("api_tokens")
        .select("id, org_id, plataforma_inteira, ativo").eq("token_hash", hash).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async contarRecentes(tokenId, desdeISO) {
      // 429 não conta: quem insiste depois de bloqueado não se prende pra sempre
      const { count, error } = await sb.from("api_log").select("id", { count: "exact", head: true })
        .eq("token_id", tokenId).gte("em", desdeISO).neq("status", 429);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async registrarLog(reg) {
      await sb.from("api_log").insert(reg);
      if (Math.random() < 0.01) { // faxina: guarda 30 dias
        await sb.from("api_log").delete().lt("em", new Date(Date.now() - 30 * 86400000).toISOString());
      }
    },
    async tocarUso(tokenId) {
      await sb.from("api_tokens").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", tokenId);
    },
    eventos: (a) => rpc("api_eventos", {
      p_org: a.org, p_desde: a.desde, p_status: a.status,
      p_after_ts: a.depois?.t ?? null, p_after_id: a.depois?.i ?? null, p_limit: a.limite,
    }),
    participantes: (a) => rpc("api_participantes", {
      p_org: a.org, p_evento: a.evento_id, p_desde: a.desde,
      p_after_ts: a.depois?.t ?? null, p_after_id: a.depois?.i ?? null, p_limit: a.limite,
    }),
  };
}

/* ---- handler -------------------------------------------------------------- */

const CABECALHOS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const resp = (status, corpo, extra = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CABECALHOS, ...extra } });
const erro = (status, codigo, mensagem, extra) => resp(status, { erro: mensagem, codigo }, extra);

export async function tratar(req, dados, cfg = {}) {
  const limitePorMinuto = cfg.limitePorMinuto ?? LIMITE_POR_MINUTO;
  const url = new URL(req.url);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const log = async (tokenId, status, qtd = null) => {
    try {
      await dados.registrarLog({ token_id: tokenId, metodo: req.method, caminho: url.pathname + url.search, status, ip, qtd });
    } catch (e) { console.error("api_log:", e); }
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CABECALHOS });
  if (req.method !== "GET") {
    return erro(405, "metodo_nao_permitido", "Esta API é somente leitura: use GET.", { Allow: "GET" });
  }

  try {
    // 1. token
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
    const token = m ? await dados.buscarToken(await sha256hex(m[1])) : null;
    if (!token || !token.ativo) {
      await log(null, 401);
      return erro(401, "token_invalido", "Token ausente, inválido ou revogado. Envie 'Authorization: Bearer <token>'.");
    }

    // 2. limite de requisições
    const recentes = await dados.contarRecentes(token.id, new Date(Date.now() - 60000).toISOString());
    if (recentes >= limitePorMinuto) {
      await log(token.id, 429);
      return erro(429, "limite_excedido",
        `Limite de ${limitePorMinuto} requisições por minuto excedido. Tente de novo em instantes.`, { "Retry-After": "60" });
    }

    // 3. rota
    const rota = /\/(eventos|participantes)\/?$/.exec(url.pathname)?.[1];
    if (!rota) {
      await log(token.id, 404);
      return erro(404, "rota_inexistente", "Rota inexistente. Use /api/v1/eventos ou /api/v1/participantes.");
    }

    // 4. parâmetros
    const q = url.searchParams;
    const invalido = async (msg) => { await log(token.id, 400); return erro(400, "parametro_invalido", msg); };

    let limite = LIMITE_MAX;
    if (q.has("limite")) {
      limite = Number(q.get("limite"));
      if (!Number.isInteger(limite) || limite < 1) return await invalido("'limite' deve ser um inteiro entre 1 e 500.");
      limite = Math.min(limite, LIMITE_MAX);
    }

    let desde = null;
    if (q.has("atualizado_desde")) {
      // "+03:00" sem url-encode chega como " 03:00" (o + vira espaço): conserta
      const bruto = q.get("atualizado_desde").trim().replace(/ (\d{2}:?\d{2})$/, "+$1");
      const ms = /^\d{4}-\d{2}-\d{2}/.test(bruto) ? Date.parse(bruto) : NaN;
      if (isNaN(ms)) return await invalido("'atualizado_desde' deve ser data/hora ISO 8601, ex.: 2026-10-15T14:30:00-03:00.");
      desde = new Date(ms).toISOString();
    }

    let depois = null;
    if (q.has("cursor")) {
      depois = decodificarCursor(q.get("cursor"));
      if (!depois) return await invalido("'cursor' inválido (use o valor de 'proxima_pagina' sem alterar).");
    }

    const org = token.plataforma_inteira ? null : token.org_id;
    let linhas, formatar;
    if (rota === "eventos") {
      const status = q.get("status");
      if (status && !STATUS_EVENTO.includes(status)) return await invalido(`'status' deve ser um de: ${STATUS_EVENTO.join(", ")}.`);
      linhas = await dados.eventos({ org, desde, status: status || null, depois, limite: limite + 1 });
      formatar = formatarEvento;
    } else {
      const eventoId = q.get("evento_id");
      if (eventoId && !UUID_RE.test(eventoId)) return await invalido("'evento_id' deve ser um UUID.");
      linhas = await dados.participantes({ org, evento_id: eventoId || null, desde, depois, limite: limite + 1 });
      formatar = formatarParticipante;
    }

    // 5. página (pedimos limite+1 só pra saber se tem mais)
    const temMais = linhas.length > limite;
    const pagina = temMais ? linhas.slice(0, limite) : linhas;
    const ultimo = pagina[pagina.length - 1];
    const proxima = temMais && ultimo ? codificarCursor(ultimo.atualizado_em, ultimo.id) : null;

    await log(token.id, 200, pagina.length);
    dados.tocarUso(token.id).catch(() => {});
    return resp(200, { dados: pagina.map(formatar), proxima_pagina: proxima });
  } catch (e) {
    console.error("api:", e);
    await log(null, 500);
    return erro(500, "erro_interno", "Erro interno. Tente de novo; se persistir, avise o suporte.");
  }
}

if (!globalThis.__API_TEST__) {
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const dados = criarDados(sb);
  const limitePorMinuto = Number(Deno.env.get("API_LIMITE_POR_MINUTO")) || LIMITE_POR_MINUTO;
  Deno.serve((req) => tratar(req, dados, { limitePorMinuto }));
}
