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
// Deploy:  supabase functions deploy webhook-in
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const escopos = [body, body.data, body.buyer, body.customer, body.contact, body.order, body.comprador, body.participante]
    .filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  for (const esc of escopos) {
    for (const k of chaves) {
      const v = esc[k];
      if (v != null && v !== "") return String(v);
    }
  }
  return "";
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
    const cfg = (intg.config || {}) as Record<string, unknown>;
    const mapa = (cfg.mapa || {}) as Record<string, string>;
    const val = (campo: string, chaves: string[]) =>
      (mapa[campo] ? String(path(body, mapa[campo]) ?? "") : "") || acha(body, chaves);

    const email = val("email", ["email", "e-mail", "buyer_email", "email_address", "mail"]).trim().toLowerCase();
    const nome = val("nome", ["nome", "name", "full_name", "buyer_name", "first_name"]).trim();
    if (!email && !nome) return json({ erro: "Payload sem nome nem e-mail." }, 422);

    const telefone = val("telefone", ["telefone", "phone", "celular", "whatsapp", "mobile", "phone_number"]).trim();
    const empresa = val("empresa", ["empresa", "company", "organization"]).trim();
    const ingresso = val("ingresso", ["ingresso", "ticket", "ticket_name", "product", "produto", "plano", "categoria"]).trim();
    const statusRaw = val("status", ["status", "payment_status", "situacao", "state"]).trim().toLowerCase();
    const qtd = Number(val("quantidade", ["quantidade", "quantity", "qty"])) || 1;

    const statusMap = (cfg.status_map || {}) as Record<string, string>;
    let situacao = statusMap[statusRaw] || (cfg.situacao_padrao as string) || "";
    if (!situacao) {
      if (/paid|approved|aprovad|pago|confirm|complete/.test(statusRaw)) situacao = "Confirmado";
      else if (/pending|pendente|waiting|aguard/.test(statusRaw)) situacao = "Pendente";
      else if (/refund|cancel|estorn|reembols|charged?back/.test(statusRaw)) situacao = "Desativado";
      else situacao = "Confirmado";
    }

    const reg: Record<string, unknown> = {
      evento_id: eventoId, nome: nome || email, tipo: "Convidado", pagamento: "Externo",
      situacao, quantidade: qtd,
    };
    if (email) reg.email = email;
    if (telefone) reg.telefone = telefone;
    if (empresa) reg.empresa = empresa;
    if (ingresso) reg.ingresso = ingresso;

    // primeira etapa do pipeline
    const { data: et } = await sb.from("etapas_participante").select("id")
      .eq("evento_id", eventoId).order("ordem").limit(1).maybeSingle();
    if (et?.id) reg.etapa_id = et.id;

    let existente = null;
    if (email) {
      const { data } = await sb.from("participantes").select("id").eq("evento_id", eventoId).ilike("email", email).limit(1);
      existente = data?.[0] || null;
    }

    let resultado;
    if (existente) {
      // atualização: só situação + contatos que vieram no payload
      const patch: Record<string, unknown> = { situacao };
      if (telefone) patch.telefone = telefone;
      if (empresa) patch.empresa = empresa;
      if (ingresso) patch.ingresso = ingresso;
      const { data, error } = await sb.from("participantes").update(patch).eq("id", existente.id).select("id, codigo").single();
      if (error) return json({ erro: error.message }, 500);
      resultado = { acao: "atualizado", ...data };
    } else {
      const { data, error } = await sb.from("participantes").insert(reg).select("id, codigo").single();
      if (error) return json({ erro: error.message }, 500);
      resultado = { acao: "criado", ...data };
    }

    await sb.from("webhook_entregas").insert({
      integracao_id: intg.id, evento_id: eventoId, gatilho: "entrada",
      status: 200, ok: true, payload: { recebido: body, resultado },
    });

    return json({ ok: true, ...resultado });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
