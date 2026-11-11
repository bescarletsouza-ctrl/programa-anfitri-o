// =============================================================================
// Edge Function: webhook-in
// Recebe inscrições de fora (ticketeira, gateway de pagamento, formulário,
// Zapier...) e cria/atualiza participantes.
//
//   POST https://<ref>.functions.supabase.co/webhook-in?evento_id=UUID&token=XXXX
//
// O token vem da integração tipo "entrada" cadastrada na aba Integrações.
// Casa o participante por e-mail; se não existe, cria. Aceita um corpo "solto"
// (procura nome/email/telefone/etc. em várias chaves comuns) ou um mapa
// explícito em config.mapa = { "email": "buyer.email", "nome": "buyer.name" }.
//
// Mover de etapa (ex.: n8n): corpo { "email": "...", "etapa": "Interesse VIP" } ou
// "Mover para a etapa" fixo na origem (config.etapa_destino). Quem já existe só
// troca de etapa; quem não existe é criado já nela.
//
// Deploy:  supabase functions deploy webhook-in
// =============================================================================
// "npm:" é resolvido pelo próprio Supabase (não depende do esm.sh, que às vezes dá
// timeout no deploy). Versão fixa, a mesma que já usávamos.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// pega o valor de um caminho "a.b.c" dentro de um objeto
const path = (o: unknown, p: string): unknown =>
  p.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);

// primeira chave existente (busca rasa e em objetos aninhados comuns)
function acha(body: Record<string, unknown>, chaves: string[]): string {
  const escopos = [body, body.data, body.buyer, body.customer, body.contact, body.order, body.comprador, body.participante, body._hubla, body._guru]
    .filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  for (const esc of escopos) {
    for (const k of chaves) {
      const v = esc[k];
      // só texto/número: um objeto (ex.: "product": {...} da Guru) viraria "[object Object]"
      if ((typeof v === "string" || typeof v === "number") && v !== "") return String(v);
    }
  }
  return "";
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Categoria pelo NOME da oferta (a Guru não tem campo de categoria): o mapa é
// { "trecho do nome": "CATEGORIA" } — compara sem acento/maiúscula, vale se o
// nome da oferta CONTÉM o trecho (ou é igual), e o trecho mais longo ganha.
export function categoriaPorNome(mapa: Record<string, string> | undefined, nome: string): string {
  const alvo = norm(nome);
  if (!mapa || !alvo) return "";
  const entradas = Object.entries(mapa)
    .map(([k, v]) => [norm(k), String(v ?? "").trim()] as [string, string])
    .filter(([k, v]) => k && v)
    .sort((a, b) => b[0].length - a[0].length);
  const exata = entradas.find(([k]) => k === alvo);
  if (exata) return exata[1];
  return entradas.find(([k]) => alvo.includes(k))?.[1] || "";
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

// A Guru (Digital Manager) manda o comprador em "contact" e o produto/oferta em
// "product" / "product.offer". Só vale pra integração marcada como "Guru" (ou
// payload com webhook_type), pra não confundir com outras origens.
export function extrairGuru(body: Record<string, unknown>, provedor?: string): Record<string, unknown> | null {
  if (provedor !== "Guru" && typeof body?.webhook_type !== "string") return null;
  const c = obj(body.contact), prod = obj(body.product);
  const oferta = obj(prod.offer), ofertaTopo = obj(body.offer);
  const ofertaNome = txt(oferta.name) || txt(ofertaTopo.name) || txt(body.offer_name);
  const ddd = txt(c.phone_local_code), num = txt(c.phone_number);
  // número sem DDD (até 9 dígitos) + DDD separado → junta; senão usa como veio
  const telefone = ddd && num && num.replace(/\D/g, "").length <= 9 ? ddd + num : num;
  return {
    email: txt(c.email) || txt(body.email),
    nome: txt(c.name) || txt(body.name),
    telefone,
    ingresso: ofertaNome,           // sem mapa de categorias, o nome da oferta vira o ingresso
    status: txt(body.status),
    produtoNome: txt(prod.name),
    ofertaNome,
    transacaoId: txt(body.id),
  };
}

// "R$ 1.234,56" | "1234,56" | "1234.56" | 1234.56 → 1234.56 (null se não for valor)
export function paraNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s) || s.includes("-")) return null;
  const ponto = s.lastIndexOf("."), virg = s.lastIndexOf(",");
  if (ponto >= 0 && virg >= 0) {
    // os dois aparecem: o que vem por último é o decimal
    s = ponto > virg ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (virg >= 0) {
    s = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.500" = mil e quinhentos
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Valor pago na Guru: tenta os campos mais prováveis, em ordem, e devolve
// também QUAL caminho achou (vai no log do webhook pra conferência). Se o seu
// payload usa outro, informe em "Mapa de campos": { "valor_pago": "caminho.do.campo" }.
const CAMINHOS_VALOR_GURU = [
  "payment.total", "payment.gross", "payment.value", "payment.amount",
  "product.total_value", "total_value", "value", "amount", "total", "product.unit_value",
];
export function achaValorGuru(body: Record<string, unknown>): { valor: number | null; caminho: string } {
  for (const c of CAMINHOS_VALOR_GURU) {
    const n = paraNumero(path(body, c));
    if (n != null) return { valor: n, caminho: c };
  }
  return { valor: null, caminho: "" };
}

// Forma de pagamento da venda: aprovada = "Pago"; estorno = "Reembolsado";
// cancelada = "Cancelado"; boleto/aguardando e o que não for reconhecido ficam
// "Externo" (não dá pra afirmar que foi pago).
export function pagamentoGuru(statusRaw: string): string {
  if (/refund|estorn|reembols|charged?back|dispute/.test(statusRaw)) return "Reembolsado";
  if (/cancel/.test(statusRaw)) return "Cancelado";
  if (/pending|pendente|waiting|aguard|unpaid|billet|boleto|analys|analis/.test(statusRaw)) return "Externo";
  if (/approv|aprov|paid|pago|complet|confirm|success|captur/.test(statusRaw)) return "Pago";
  return "Externo";
}

export const GURU_CANCELADO = /refund|cancel|estorn|reembols|charged?back|dispute/;
export const GURU_PENDENTE = /pending|pendente|waiting|aguard|unpaid|billet|boleto|analys|analis/;
export const GURU_IGNORAR = /abandon|expir|checkout|started/;

// Etapa do pipeline de Participantes por id, nome exato ou (se ninguém bater) nome
// que contém o texto — sem diferenciar maiúscula/acento. Devolve null se não achar.
export type EtapaPart = { id: string; nome: string; situacao_alvo?: string | null };
export function acharEtapa(etapas: EtapaPart[], ref: string): EtapaPart | null {
  const alvo = norm(ref);
  if (!alvo) return null;
  return etapas.find((e) => e.id === ref.trim())
    || etapas.find((e) => norm(e.nome) === alvo)
    || etapas.find((e) => norm(e.nome).includes(alvo))
    || null;
}

// A Hubla manda um envelope próprio (webhooks v2): dados do comprador em
// event.invoice.payer / event.user, nome dividido em firstName+lastName, e
// o produto/oferta em event.product. Normaliza num objeto plano e injeta
// como mais um "escopo" pra acha() achar sem precisar de mapa manual.
function extrairHubla(body: Record<string, unknown>): Record<string, unknown> | null {
  const ev = body?.event as Record<string, unknown> | undefined;
  if (!ev || typeof ev !== "object") return null;
  const invoice = (ev.invoice || {}) as Record<string, unknown>;
  const payer = (invoice.payer || {}) as Record<string, unknown>;
  const user = (ev.user || {}) as Record<string, unknown>;
  const produto = (ev.product || {}) as Record<string, unknown>;
  const nome = [payer.firstName, payer.lastName].filter(Boolean).join(" ").trim()
    || [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    email: payer.email || user.email || "",
    nome,
    telefone: payer.phone || user.phone || "",
    ingresso: produto.name || "",
    status: invoice.status || "",
    produtoId: produto.id || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Envie POST." }, 405);

  try {
    const u = new URL(req.url);
    const eventoId = u.searchParams.get("evento_id") || "";
    const token = u.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
    if (!eventoId || !token) return json({ erro: "Faltou evento_id ou token." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: intg } = await sb.from("integracoes").select("*")
      .eq("evento_id", eventoId).eq("token", token).eq("tipo", "entrada").eq("ativo", true).maybeSingle();
    if (!intg) return json({ erro: "Integração de entrada não encontrada ou inativa." }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const hubla = extrairHubla(body);
    if (hubla) body._hubla = hubla;
    const guru = extrairGuru(body, (intg.provedor as string) || "");
    if (guru) body._guru = guru;

    // registra a tentativa no log (sucesso ou falha) mesmo se der erro adiante
    const logar = (status: number, ok: boolean, erro?: string, resultado?: unknown) =>
      sb.from("webhook_entregas").insert({
        integracao_id: intg.id, evento_id: eventoId, gatilho: "entrada",
        status, ok, erro: erro || null, payload: { recebido: body, resultado },
      }).then(() => {}, () => {});

    const cfg = (intg.config || {}) as Record<string, unknown>;
    const mapa = (cfg.mapa || {}) as Record<string, string>;
    const val = (campo: string, chaves: string[]) =>
      (mapa[campo] ? String(path(body, mapa[campo]) ?? "") : "") || acha(body, chaves);

    const email = val("email", ["email", "e-mail", "buyer_email", "email_address", "mail"]).trim().toLowerCase();
    const nome = val("nome", ["nome", "name", "full_name", "buyer_name", "first_name"]).trim();
    if (!email && !nome) {
      await logar(422, false, "Payload sem nome nem e-mail.");
      return json({ erro: "Payload sem nome nem e-mail." }, 422);
    }

    const telefone = val("telefone", ["telefone", "phone", "celular", "whatsapp", "mobile", "phone_number"]).trim();
    const empresa = val("empresa", ["empresa", "company", "organization"]).trim();
    // Categoria: 1) mapa por ID de produto/oferta (Hubla), 2) mapa por NOME da
    // oferta (Guru, que não tem campo de categoria), 3) "Categoria padrão" da
    // Origem, 4) detecção genérica pelo payload (na Guru: o próprio nome da oferta).
    const categoriasPorProduto = (cfg.categorias_por_produto || {}) as Record<string, string>;
    const produtoId = String((hubla?.produtoId as string) || "").trim();
    const categoriasPorOferta = (cfg.categorias_por_oferta || {}) as Record<string, string>;
    const porOferta = guru
      ? categoriaPorNome(categoriasPorOferta, guru.ofertaNome as string) || categoriaPorNome(categoriasPorOferta, guru.produtoNome as string)
      : "";
    const ingresso = (produtoId && categoriasPorProduto[produtoId] ? categoriasPorProduto[produtoId] : "").trim()
      || porOferta
      || ((cfg.ingresso_padrao as string) || "").trim()
      || val("ingresso", ["ingresso", "ticket", "ticket_name", "ticket_type", "product", "produto", "plano", "categoria"]).trim();

    // Filtro opcional (Origem → "Só aceitar vendas do produto…"): a Guru manda TODAS as
    // vendas da conta pra mesma URL; só entra quem tem esse texto no produto/oferta.
    const filtroProduto = norm(cfg.filtro_produto);
    if (filtroProduto) {
      const textoProduto = norm([guru?.produtoNome, guru?.ofertaNome, hubla?.ingresso, ingresso].filter(Boolean).join(" "));
      if (!textoProduto.includes(filtroProduto)) {
        const r = { acao: "ignorado", motivo: `produto/oferta fora do filtro "${cfg.filtro_produto}"`, produto: guru?.produtoNome, oferta: guru?.ofertaNome };
        await logar(200, true, undefined, r);
        return json({ ok: true, ...r });
      }
    }
    const faturamento = val("faturamento", ["faturamento", "revenue", "revenue_band", "billing", "faturamento_mensal"]).trim();
    const tipoRaw = val("tipo", ["tipo", "participant_type", "tipo_participante"]).trim();
    // payment_status antes de status: "status" sozinho às vezes é um status
    // genérico do registro (ex.: "ativo"), não o do pagamento.
    const statusRaw = val("status", ["payment_status", "status", "situacao", "state"]).trim().toLowerCase();
    const qtd = Number(val("quantidade", ["quantidade", "quantity", "ticket_quantity", "qty"])) || 1;

    // Guru: carrinho abandonado/expirado não é venda — não cria participante
    if (guru && GURU_IGNORAR.test(statusRaw)) {
      const r = { acao: "ignorado", motivo: `status "${statusRaw}" não é venda` };
      await logar(200, true, undefined, r);
      return json({ ok: true, ...r });
    }

    const statusMap = (cfg.status_map || {}) as Record<string, string>;
    let situacao = statusMap[statusRaw] || "";
    // Guru: estorno/cancelamento vence a "Situação padrão" (senão um reembolso
    // viraria Confirmado) e boleto/aguardando fica Pendente
    if (!situacao && guru) {
      if (GURU_CANCELADO.test(statusRaw)) situacao = "Desativado";
      else if (GURU_PENDENTE.test(statusRaw)) situacao = "Pendente";
    }
    if (!situacao) situacao = (cfg.situacao_padrao as string) || "";
    if (!situacao) {
      // Sem "Situação padrão" configurada na Origem, entra sempre como
      // Pré-inscrito (mesmo pago/aprovado) — a equipe confirma manualmente
      // depois. Só cancelamento/estorno já cai como Desativado direto.
      if (/refund|cancel|estorn|reembols|charged?back/.test(statusRaw)) situacao = "Desativado";
      else if (/pending|pendente|waiting|aguard|unpaid/.test(statusRaw)) situacao = "Pendente";
      else situacao = "Pré-inscrito";
    }

    // Pagamento e valor pago. Guru: "Pago" quando aprovada + valor da venda (ver
    // achaValorGuru). Qualquer origem pode informar o caminho do valor no "Mapa de
    // campos" ({ "valor_pago": "..." }). O valor só é gravado quando a venda está Paga.
    const pagamento = guru ? pagamentoGuru(statusRaw) : "Externo";
    const valorInfo = mapa.valor_pago
      ? { valor: paraNumero(path(body, mapa.valor_pago)), caminho: mapa.valor_pago }
      : guru ? achaValorGuru(body) : { valor: null, caminho: "" };
    const valorPago = pagamento === "Pago" || (!guru && mapa.valor_pago) ? valorInfo.valor : null;

    // Etapas do pipeline do evento (a 1ª é onde entra quem chega sem etapa definida)
    let etapasEv: EtapaPart[] = [];
    {
      let q = await sb.from("etapas_participante").select("id, nome, situacao_alvo")
        .eq("evento_id", eventoId).order("ordem");
      if (q.error) q = await sb.from("etapas_participante").select("id, nome").eq("evento_id", eventoId).order("ordem");
      etapasEv = (q.data || []) as EtapaPart[];
    }

    // Mover para uma etapa: o corpo manda "etapa" (nome ou id; ou o caminho em
    // mapa.etapa) ou a origem fixa uma "etapa_destino" na configuração.
    // Com etapa definida o webhook vira um "mover": quem já existe só troca de
    // etapa (não reescreve situação/categoria); quem não existe é criado já nela.
    const etapaDoCorpo = val("etapa", ["etapa", "etapa_destino", "stage", "pipeline_stage"]).trim();
    const etapaDaOrigem = String(cfg.etapa_destino || "").trim();
    let etapaDestino = etapaDoCorpo ? acharEtapa(etapasEv, etapaDoCorpo) : null;
    let etapaIgnorada = "";
    if (etapaDoCorpo && !etapaDestino) {
      // um campo "etapa" solto no corpo que não bate com nenhuma etapa do evento não
      // pode derrubar integrações antigas: segue como antes e registra no log
      etapaIgnorada = etapaDoCorpo;
    }
    if (!etapaDestino && etapaDaOrigem) {
      etapaDestino = acharEtapa(etapasEv, etapaDaOrigem);
      if (!etapaDestino) {
        // etapa configurada de propósito na origem e não encontrada (apagada/renomeada): avisa
        const msg = `Etapa "${etapaDaOrigem}" (configurada na origem) não existe neste evento. Etapas: ${etapasEv.map((e) => e.nome).join(", ") || "(nenhuma)"}.`;
        await logar(422, false, msg);
        return json({ erro: msg }, 422);
      }
    }
    // a etapa pode definir a situação do participante que entra nela (situação-alvo)
    const sitDaEtapa = etapaDestino?.situacao_alvo || "";
    const situacaoNova = sitDaEtapa || situacao;

    const reg: Record<string, unknown> = {
      evento_id: eventoId, nome: nome || email, tipo: tipoRaw || "Convidado", pagamento,
      situacao: situacaoNova, quantidade: qtd,
    };
    if (valorPago != null) reg.valor_pago = valorPago;
    if (email) reg.email = email;
    if (telefone) reg.telefone = telefone;
    if (empresa) reg.empresa = empresa;
    if (ingresso) reg.ingresso = ingresso;
    if (faturamento) reg.faturamento = faturamento;

    const etapaInicial = etapaDestino?.id || etapasEv[0]?.id;
    if (etapaInicial) reg.etapa_id = etapaInicial;

    let existente: { id: string; etapa_id: string | null } | null = null;
    if (email) {
      const { data } = await sb.from("participantes").select("id, etapa_id").eq("evento_id", eventoId).ilike("email", email).limit(1);
      existente = (data?.[0] as { id: string; etapa_id: string | null }) || null;
    }

    // Guru: estorno/cancelamento de quem nunca entrou na plataforma não cria ninguém
    if (guru && situacao === "Desativado" && !existente) {
      const r = { acao: "ignorado", motivo: `status "${statusRaw}" de alguém que não está na lista` };
      await logar(200, true, undefined, r);
      return json({ ok: true, ...r });
    }

    let resultado;
    if (existente) {
      // atualização: situação + contatos que vieram no payload
      const patch: Record<string, unknown> = {};
      if (!etapaDestino) {
        patch.situacao = situacao;
      } else {
        // modo "mover": não mexe na situação/categoria atuais, só aplica o que a etapa
        // define (situação-alvo) ou um status enviado de propósito no corpo
        if (sitDaEtapa) patch.situacao = sitDaEtapa;
        else if (statusRaw && statusMap[statusRaw]) patch.situacao = statusMap[statusRaw];
        if (existente.etapa_id !== etapaDestino.id) patch.etapa_id = etapaDestino.id;
      }
      if (telefone) patch.telefone = telefone;
      if (empresa) patch.empresa = empresa;
      if (ingresso && !etapaDestino) patch.ingresso = ingresso;
      if (faturamento) patch.faturamento = faturamento;
      // Guru: a venda manda no pagamento (aprovada → Pago; estorno → Reembolsado…)
      if (guru) patch.pagamento = pagamento;
      if (valorPago != null) patch.valor_pago = valorPago;
      const salvarPatch = () => Object.keys(patch).length
        ? sb.from("participantes").update(patch).eq("id", existente!.id).select("id, codigo").single()
        : sb.from("participantes").select("id, codigo").eq("id", existente!.id).single();
      let r = await salvarPatch();
      if (r.error && /valor_pago/.test(r.error.message)) {
        // migração 0042 ainda não rodou: salva o resto sem o valor
        delete patch.valor_pago;
        r = await salvarPatch();
      }
      if (r.error) { await logar(500, false, r.error.message); return json({ erro: r.error.message }, 500); }
      resultado = {
        acao: "atualizado", ...r.data, ingresso: etapaDestino ? undefined : (ingresso || null),
        situacao: (patch.situacao as string) ?? (etapaDestino ? undefined : situacao),
        etapa: etapaDestino?.nome, movido: etapaDestino ? "etapa_id" in patch : undefined, etapa_ignorada: etapaIgnorada || undefined,
        pagamento: guru ? pagamento : undefined, valor_pago: patch.valor_pago ?? null, valor_origem: valorInfo.caminho || null,
      };
    } else {
      // "Tipo padrão" da origem (ex.: "Aplicação") separa quem chega por aqui de
      // quem veio por convite de anfitrião (esses continuam "Convidado"). Se o
      // tipo ainda não existe no evento, é criado — assim aparece nos filtros,
      // no cadastro e na Visão por tipo. Só vale pra quem NÃO mandou tipo no payload.
      const tipoPadrao = ((cfg.tipo_padrao as string) || "").trim();
      if (!tipoRaw && tipoPadrao) {
        const { data: gs } = await sb.from("grupos").select("nome").eq("evento_id", eventoId);
        const achado = (gs || []).find((g) => norm(g.nome) === norm(tipoPadrao));
        if (!achado) await sb.from("grupos").insert({ evento_id: eventoId, nome: tipoPadrao });
        reg.tipo = achado?.nome || tipoPadrao;
      }
      let r = await sb.from("participantes").insert(reg).select("id, codigo").single();
      if (r.error && /valor_pago/.test(r.error.message)) {
        // migração 0042 ainda não rodou: cria sem o valor (não perde a venda)
        delete reg.valor_pago;
        r = await sb.from("participantes").insert(reg).select("id, codigo").single();
      }
      if (r.error) { await logar(500, false, r.error.message); return json({ erro: r.error.message }, 500); }
      resultado = { acao: "criado", ...r.data, tipo: reg.tipo, ingresso: ingresso || null, situacao: situacaoNova, etapa: etapaDestino?.nome, etapa_ignorada: etapaIgnorada || undefined, pagamento, valor_pago: reg.valor_pago ?? null, valor_origem: valorInfo.caminho || null };
    }

    await logar(200, true, undefined, resultado);
    return json({ ok: true, ...resultado });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    try {
      const u = new URL(req.url);
      const eventoId = u.searchParams.get("evento_id") || null;
      const token = u.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
      if (eventoId && token) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: intg } = await sb.from("integracoes").select("id")
          .eq("evento_id", eventoId).eq("token", token).eq("tipo", "entrada").maybeSingle();
        if (intg) {
          await sb.from("webhook_entregas").insert({
            integracao_id: intg.id, evento_id: eventoId, gatilho: "entrada",
            status: 500, ok: false, erro: msg,
          });
        }
      }
    } catch { /* log é best-effort */ }
    return json({ erro: msg }, 500);
  }
});
