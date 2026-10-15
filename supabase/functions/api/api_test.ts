// @ts-nocheck
// Testes da Edge Function "api". Rodam em Deno:
//     deno test supabase/functions/api/api_test.ts
// e também num navegador (basta importar este arquivo e ler globalThis.__resultados).
// Sem banco: a camada de dados é trocada por um fake.
globalThis.__API_TEST__ = true;
const api = await import("./index.ts");

const testes = [];
const teste = (nome, fn) => (globalThis.Deno?.test ? Deno.test(nome, fn) : testes.push({ nome, fn }));
const igual = (real, esperado, msg = "") => {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${msg} esperado ${b}, veio ${a}`);
};
const verdade = (cond, msg = "falhou") => { if (!cond) throw new Error(msg); };

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const EV = "33333333-3333-4333-8333-333333333333";
const ORG = "44444444-4444-4444-8444-444444444444";

async function hash(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// fake: tokens conhecidos + contadores + o que cada consulta recebeu
async function fakeDados(sobrescrever = {}) {
  const tokens = {
    [await hash("wev_org")]: { id: "tok-org", org_id: ORG, plataforma_inteira: false, ativo: true },
    [await hash("wev_plat")]: { id: "tok-plat", org_id: null, plataforma_inteira: true, ativo: true },
    [await hash("wev_revogado")]: { id: "tok-rev", org_id: ORG, plataforma_inteira: false, ativo: false },
  };
  const d = {
    logs: [], chamadas: [], recentes: 0, eventosRows: [], participantesRows: [],
    buscarToken: async (h) => tokens[h] || null,
    contarRecentes: async () => d.recentes,
    registrarLog: async (r) => { d.logs.push(r); },
    tocarUso: async () => {},
    eventos: async (a) => { d.chamadas.push(["eventos", a]); return d.eventosRows; },
    participantes: async (a) => { d.chamadas.push(["participantes", a]); return d.participantesRows; },
    ...sobrescrever,
  };
  return d;
}
const req = (caminho, { token = "wev_org", metodo = "GET", headers = {} } = {}) =>
  new Request("https://x.test" + caminho, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
const corpo = async (r) => r.json();

/* ---- utilidades ---- */
teste("isoSP: ISO com fuso de Brasília", () => {
  igual(api.isoSP("2026-10-15T17:30:00.123456+00:00"), "2026-10-15T14:30:00-03:00");
  igual(api.isoSP(null), null);
  igual(api.isoSP("lixo"), null);
});
teste("dataParaISO: data do evento vira meia-noite de Brasília", () => {
  igual(api.dataParaISO("2026-10-15"), "2026-10-15T00:00:00-03:00");
  igual(api.dataParaISO(null), null);
});
teste("cursor: ida e volta, e rejeita lixo", () => {
  const c = api.codificarCursor("2026-10-15T17:30:00.123456+00:00", ID1);
  verdade(!/[+/=]/.test(c), "cursor deve ser url-safe");
  igual(api.decodificarCursor(c), { t: "2026-10-15T17:30:00.123456+00:00", i: ID1 });
  igual(api.decodificarCursor("abc"), null);
  igual(api.decodificarCursor(btoa(JSON.stringify({ t: "x", i: "y" }))), null);
});
teste("parsePreco", () => {
  igual(api.parsePreco("R$ 1.500,00"), 1500);
  igual(api.parsePreco("R$ 500"), 500);
  igual(api.parsePreco("R$ 97,50"), 97.5);
  igual(api.parsePreco("1.500"), 1500);
  igual(api.parsePreco("500,00"), 500);
  igual(api.parsePreco("Gratuito"), null);
  igual(api.parsePreco(""), null);
  igual(api.parsePreco(null), null);
});
teste("valorPago: só quem pagou, preço de tabela × quantidade", () => {
  igual(api.valorPago({ pagamento: "Pago", preco_ingresso: "R$ 500,00", quantidade: 2 }), 1000);
  igual(api.valorPago({ pagamento: "Externo", situacao: "Confirmado", preco_ingresso: "R$ 97", quantidade: 1 }), 97);
  igual(api.valorPago({ pagamento: "Externo", situacao: "Pré-inscrito", preco_ingresso: "R$ 97", quantidade: 1 }), null);
  igual(api.valorPago({ pagamento: "Convidado", preco_ingresso: "R$ 500", quantidade: 1 }), null);
  igual(api.valorPago({ pagamento: "Gratuito", preco_ingresso: "R$ 500", quantidade: 1 }), null);
  igual(api.valorPago({ pagamento: "Pago", preco_ingresso: null, quantidade: 1 }), null);
});
teste("statusInscricao: todas as regras", () => {
  const s = api.statusInscricao;
  igual(s({ pagamento: "Cancelado", situacao: "Confirmado" }), "cancelado");
  igual(s({ pagamento: "Reembolsado" }), "cancelado");
  igual(s({ pagamento: "Pago", situacao: "Desativado" }), "cancelado");
  igual(s({ situacao: "Fila de espera" }), "lista de espera");
  igual(s({ situacao: "Confirmado", convidado_status: "Recusado" }), "reprovado");
  igual(s({ situacao: "Pré-inscrito", convidado_status: "Aprovado" }), "aprovado");
  igual(s({ situacao: "Pré-inscrito", convidado_status: "Confirmado" }), "aprovado");
  igual(s({ situacao: "Confirmado", convidado_status: "Pendente" }), "inscrito");
  igual(s({ situacao: "Confirmado" }), "aprovado");
  igual(s({ situacao: "Pendente" }), "inscrito");
  igual(s({ situacao: "Pré-inscrito" }), "inscrito");
  // cancelamento vence tudo
  igual(s({ pagamento: "Cancelado", convidado_status: "Aprovado", situacao: "Fila de espera" }), "cancelado");
});

/* ---- handler: autenticação e método ---- */
teste("sem token → 401", async () => {
  const d = await fakeDados();
  const r = await api.tratar(req("/api/v1/eventos", { token: null }), d);
  igual(r.status, 401);
  igual((await corpo(r)).codigo, "token_invalido");
  igual(d.chamadas.length, 0, "não pode consultar dados sem token");
});
teste("token inexistente → 401", async () => {
  const r = await api.tratar(req("/api/v1/eventos", { token: "wev_qualquer" }), await fakeDados());
  igual(r.status, 401);
});
teste("token revogado → 401", async () => {
  const d = await fakeDados();
  const r = await api.tratar(req("/api/v1/eventos", { token: "wev_revogado" }), d);
  igual(r.status, 401);
  igual(d.chamadas.length, 0);
});
teste("cabeçalho sem 'Bearer' → 401", async () => {
  const r = await api.tratar(req("/api/v1/eventos", { token: null, headers: { authorization: "wev_org" } }), await fakeDados());
  igual(r.status, 401);
});
teste("POST/PUT/DELETE/PATCH → 405 (somente leitura)", async () => {
  for (const metodo of ["POST", "PUT", "DELETE", "PATCH"]) {
    const d = await fakeDados();
    const r = await api.tratar(req("/api/v1/participantes", { metodo }), d);
    igual(r.status, 405, metodo);
    igual(r.headers.get("allow"), "GET");
    igual(d.chamadas.length, 0);
  }
});
teste("401 e 429 ficam registrados no log", async () => {
  const d = await fakeDados();
  await api.tratar(req("/api/v1/eventos", { token: "wev_nao_existe" }), d);
  igual(d.logs[0].status, 401);
  d.recentes = 60;
  await api.tratar(req("/api/v1/eventos"), d);
  igual(d.logs[1].status, 429);
  igual(d.logs[1].token_id, "tok-org");
});

/* ---- limite de requisições ---- */
teste("60/min: a 61ª vira 429 com Retry-After", async () => {
  const d = await fakeDados();
  d.recentes = 59;
  igual((await api.tratar(req("/api/v1/eventos"), d)).status, 200);
  d.recentes = 60;
  const r = await api.tratar(req("/api/v1/eventos"), d);
  igual(r.status, 429);
  igual(r.headers.get("retry-after"), "60");
  igual((await corpo(r)).codigo, "limite_excedido");
});
teste("limite configurável", async () => {
  const d = await fakeDados();
  d.recentes = 5;
  igual((await api.tratar(req("/api/v1/eventos"), d, { limitePorMinuto: 5 })).status, 429);
});

/* ---- rotas e parâmetros ---- */
teste("rota inexistente → 404", async () => {
  const r = await api.tratar(req("/api/v1/outracoisa"), await fakeDados());
  igual(r.status, 404);
});
teste("parâmetros inválidos → 400 (e sem tocar no banco)", async () => {
  for (const caminho of [
    "/api/v1/eventos?status=qualquer",
    "/api/v1/eventos?atualizado_desde=ontem",
    "/api/v1/eventos?cursor=lixo",
    "/api/v1/eventos?limite=0",
    "/api/v1/eventos?limite=abc",
    "/api/v1/participantes?evento_id=123",
  ]) {
    const d = await fakeDados();
    const r = await api.tratar(req(caminho), d);
    igual(r.status, 400, caminho);
    igual((await corpo(r)).codigo, "parametro_invalido", caminho);
    igual(d.chamadas.length, 0, caminho);
  }
});

/* ---- escopo do token ---- */
teste("token de organização só consulta a própria org", async () => {
  const d = await fakeDados();
  await api.tratar(req("/api/v1/participantes"), d);
  igual(d.chamadas[0][1].org, ORG);
  const d2 = await fakeDados();
  await api.tratar(req("/api/v1/eventos"), d2);
  igual(d2.chamadas[0][1].org, ORG);
});
teste("token da plataforma consulta tudo (org nula)", async () => {
  const d = await fakeDados();
  await api.tratar(req("/api/v1/participantes", { token: "wev_plat" }), d);
  igual(d.chamadas[0][1].org, null);
});

/* ---- /eventos ---- */
teste("eventos: formato, status e filtros repassados", async () => {
  const d = await fakeDados();
  d.eventosRows = [{
    id: EV, nome: "A Mesa ed 006", data_evento: "2026-11-20", status: "ativo", local: "São Paulo",
    criado_em: "2026-09-01T12:00:00+00:00", atualizado_em: "2026-10-15T17:30:00.5+00:00",
  }];
  const r = await api.tratar(req("/api/v1/eventos?status=ativo&atualizado_desde=2026-10-01T00:00:00-03:00"), d);
  igual(r.status, 200);
  const j = await corpo(r);
  igual(j, {
    dados: [{
      id: EV, nome: "A Mesa ed 006", data_inicio: "2026-11-20T00:00:00-03:00", data_fim: null, status: "ativo",
      local: "São Paulo", criado_em: "2026-09-01T09:00:00-03:00", atualizado_em: "2026-10-15T14:30:00-03:00",
    }],
    proxima_pagina: null,
  });
  igual(d.chamadas[0][1].status, "ativo");
  igual(d.chamadas[0][1].desde, "2026-10-01T03:00:00.000Z");
  igual(d.chamadas[0][1].limite, 501, "pede limite+1 pra saber se há próxima página");
});
teste("atualizado_desde com '+' sem url-encode (vira espaço) ainda funciona", async () => {
  const d = await fakeDados();
  const r = await api.tratar(req("/api/v1/eventos?atualizado_desde=2026-10-01T00:00:00+03:00"), d);
  igual(r.status, 200);
  igual(d.chamadas[0][1].desde, "2026-09-30T21:00:00.000Z");
});

/* ---- /participantes ---- */
const linhaParticipante = (n, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, evento_id: EV, evento_nome: "A Mesa ed 006", tipo: "Convidado",
  nome: `Pessoa ${n}`, email: `p${n}@x.com`, telefone: "(11) 99999-0000",
  ingresso: "GOLD", preco_ingresso: "R$ 500,00", quantidade: 1, pagamento: "Pago", situacao: "Confirmado",
  convidado_status: null, presente: false, checkin_at: null,
  utm_source: null, utm_medium: null, utm_campaign: null,
  criado_em: "2026-10-01T12:00:00+00:00", atualizado_em: `2026-10-10T12:00:0${n % 10}.000001+00:00`, ...extra,
});
teste("participantes: formato completo", async () => {
  const d = await fakeDados();
  d.participantesRows = [linhaParticipante(1, {
    presente: true, checkin_at: "2026-11-20T22:10:00+00:00",
    convidado_status: "Aprovado", utm_source: "instagram", utm_medium: "pyero", utm_campaign: "a-mesa",
  })];
  const j = await corpo(await api.tratar(req(`/api/v1/participantes?evento_id=${EV}`), d));
  igual(j.dados[0], {
    id: "00000000-0000-4000-8000-000000000001", evento_id: EV, evento_nome: "A Mesa ed 006", tipo: "Convidado",
    nome: "Pessoa 1", email: "p1@x.com", telefone: "(11) 99999-0000",
    tipo_ingresso: "GOLD", valor_pago: 500, pagamento: "Pago", status_inscricao: "aprovado",
    checkin: true, checkin_em: "2026-11-20T19:10:00-03:00",
    utm_source: "instagram", utm_medium: "pyero", utm_campaign: "a-mesa",
    criado_em: "2026-10-01T09:00:00-03:00", atualizado_em: "2026-10-10T09:00:01-03:00",
  });
  igual(d.chamadas[0][1].evento_id, EV);
});
teste("paginação: devolve 'limite' registros + cursor, e o cursor continua de onde parou", async () => {
  const d = await fakeDados();
  d.participantesRows = [linhaParticipante(1), linhaParticipante(2), linhaParticipante(3)]; // 3 = limite(2)+1
  const r1 = await api.tratar(req("/api/v1/participantes?limite=2"), d);
  const j1 = await corpo(r1);
  igual(j1.dados.length, 2);
  verdade(j1.proxima_pagina, "deveria ter próxima página");
  const depois = api.decodificarCursor(j1.proxima_pagina);
  igual(depois.i, "00000000-0000-4000-8000-000000000002", "cursor aponta pro último item devolvido");
  igual(depois.t, "2026-10-10T12:00:02.000001+00:00", "cursor guarda o timestamp EXATO do banco");

  d.participantesRows = [linhaParticipante(3)];
  const j2 = await corpo(await api.tratar(req(`/api/v1/participantes?limite=2&cursor=${j1.proxima_pagina}`), d));
  igual(j2.dados.length, 1);
  igual(j2.proxima_pagina, null);
  igual(d.chamadas[1][1].depois, depois, "o cursor foi repassado pra consulta");
});
teste("limite acima de 500 é cortado em 500", async () => {
  const d = await fakeDados();
  await api.tratar(req("/api/v1/participantes?limite=9999"), d);
  igual(d.chamadas[0][1].limite, 501);
});
teste("sem limite informado: 500 por página", async () => {
  const d = await fakeDados();
  await api.tratar(req("/api/v1/participantes"), d);
  igual(d.chamadas[0][1].limite, 501);
});
teste("erro do banco → 500 genérico, sem vazar detalhe", async () => {
  const d = await fakeDados({ participantes: async () => { throw new Error("relation x does not exist"); } });
  const r = await api.tratar(req("/api/v1/participantes"), d);
  igual(r.status, 500);
  verdade(!JSON.stringify(await corpo(r)).includes("relation"), "não pode vazar a mensagem do banco");
});
teste("200 registra no log com a quantidade de linhas", async () => {
  const d = await fakeDados();
  d.participantesRows = [linhaParticipante(1), linhaParticipante(2)];
  await api.tratar(req("/api/v1/participantes"), d);
  igual(d.logs[0].status, 200);
  igual(d.logs[0].qtd, 2);
  igual(d.logs[0].token_id, "tok-org");
});

if (!globalThis.Deno?.test) {
  globalThis.__resultados = [];
  for (const t of testes) {
    try { await t.fn(); globalThis.__resultados.push({ nome: t.nome, ok: true }); }
    catch (e) { globalThis.__resultados.push({ nome: t.nome, ok: false, erro: String(e.message || e) }); }
  }
}
