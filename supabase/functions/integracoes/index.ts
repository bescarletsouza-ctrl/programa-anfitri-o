// =============================================================================
// Edge Function: integracoes
// Recebe um gatilho do admin ({evento_id, gatilho, dados}) e dispara para todas
// as integrações ativas do evento que assinam esse gatilho:
//   - webhook_saida: POST JSON na url (assinado com HMAC se houver segredo)
//   - conector: formata e envia para a plataforma (ActiveCampaign, Z-API...)
// Cada tentativa é registrada em webhook_entregas.
//
// Também atende {evento_id, integracao_id, teste:true} para enviar um payload
// de exemplo de uma integração específica.
//
// Deploy:  supabase functions deploy integracoes
// (usa SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY, já
//  presentes no ambiente da função — nenhum secret extra é obrigatório.)
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function hmac(segredo: string, corpo: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(corpo));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const GET = (o: Record<string, unknown>, ...ks: string[]) => {
  for (const k of ks) if (o?.[k] != null && o[k] !== "") return String(o[k]);
  return "";
};

// Monta a requisição HTTP para uma integração. Retorna null se não dá p/ enviar.
function montar(intg: Record<string, unknown>, gatilho: string, dados: Record<string, unknown>) {
  const cfg = (intg.config || {}) as Record<string, string>;
  const prov = String(intg.provedor || "generico");
  const corpoPadrao = { gatilho, evento_id: intg.evento_id, dados, enviado_em: new Date().toISOString() };

  if (intg.tipo === "conector" && prov === "activecampaign") {
    const base = (cfg.base_url || "").replace(/\/+$/, "");
    if (!base || !cfg.api_key) return null;
    const p = dados.participante as Record<string, string> | undefined;
    if (!p?.email) return null;
    return {
      url: `${base}/api/3/contact/sync`,
      init: {
        method: "POST",
        headers: { "Api-Token": cfg.api_key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: {
            email: p.email,
            firstName: (p.nome || "").split(" ")[0],
            lastName: (p.nome || "").split(" ").slice(1).join(" "),
            phone: p.telefone || "",
          },
        }),
      },
    };
  }

  if (intg.tipo === "conector" && prov === "zapi") {
    const inst = cfg.instancia, tok = cfg.token;
    if (!inst || !tok) return null;
    const p = dados.participante as Record<string, string> | undefined;
    const fone = (cfg.telefone_destino || p?.telefone || "").replace(/\D/g, "");
    if (!fone) return null;
    const msg = (cfg.mensagem || "Novo evento em {evento}: {nome} ({gatilho}).")
      .replaceAll("{evento}", GET(dados, "evento_nome"))
      .replaceAll("{nome}", p?.nome || "")
      .replaceAll("{gatilho}", gatilho);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.client_token) headers["Client-Token"] = cfg.client_token;
    return {
      url: `https://api.z-api.io/instances/${inst}/token/${tok}/send-text`,
      init: { method: "POST", headers, body: JSON.stringify({ phone: fone, message: msg }) },
    };
  }

  // webhook_saida / conector genérico → POST JSON na url
  if (!intg.url) return null;
  return { url: String(intg.url), init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpoPadrao) } };
}

async function entregar(sb: ReturnType<typeof createClient>, intg: Record<string, unknown>, gatilho: string, dados: Record<string, unknown>) {
  const reg: Record<string, unknown> = {
    integracao_id: intg.id, evento_id: intg.evento_id, gatilho, payload: dados,
  };
  try {
    const m = montar(intg, gatilho, dados);
    if (!m) { reg.ok = false; reg.erro = "Configuração incompleta."; }
    else {
      const init = m.init as RequestInit & { headers: Record<string, string> };
      if (intg.segredo && init.body) init.headers["X-WeEvents-Signature"] = "sha256=" + await hmac(String(intg.segredo), String(init.body));
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(m.url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      reg.status = r.status;
      reg.ok = r.ok;
      if (!r.ok) reg.erro = (await r.text().catch(() => "")).slice(0, 500);
    }
  } catch (e) {
    reg.ok = false;
    reg.erro = String((e as Error)?.message || e).slice(0, 500);
  }
  await sb.from("webhook_entregas").insert(reg);
  return reg;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const apikey = req.headers.get("apikey") || "";
    if (anon && auth !== anon && apikey !== anon) return json({ erro: "Não autorizado." }, 401);

    const { evento_id, gatilho, dados, integracao_id, teste } = await req.json();
    if (!evento_id) return json({ erro: "evento_id obrigatório." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: ev } = await sb.from("eventos").select("nome").eq("id", evento_id).maybeSingle();
    const ctx = { ...(dados || {}), evento_nome: ev?.nome || "" };

    let q = sb.from("integracoes").select("*").eq("evento_id", evento_id).eq("ativo", true).neq("tipo", "entrada");
    if (integracao_id) q = q.eq("id", integracao_id);
    const { data: intgs, error } = await q;
    if (error) return json({ erro: error.message }, 500);

    const alvo = (intgs || []).filter((i) =>
      teste || integracao_id || !gatilho || !i.eventos?.length || i.eventos.includes(gatilho),
    );
    const g = teste ? "teste" : (gatilho || "manual");
    const res = await Promise.all(alvo.map((i) => entregar(sb, i, g, ctx)));
    sb.rpc("limpar_webhook_entregas").then(() => {}, () => {});

    return json({ disparadas: res.length, entregas: res.map((r) => ({ ok: r.ok, status: r.status, erro: r.erro })) });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
