// =============================================================================
// Edge Function: enviar-email
// Dispara e-mail para participantes de um evento via Resend.
// O admin manda só os IDs; a função busca os e-mails no banco (service role),
// personaliza {nome}/{codigo}/{email}/{evento} e envia em lotes de 100.
//
// Deploy:
//   supabase functions deploy enviar-email
// Secrets (Studio → Edge Functions → enviar-email → Secrets, ou CLI):
//   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Evento <no-reply@seu-dominio.com>"
// O domínio do EMAIL_FROM precisa estar verificado no Resend.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const preencher = (txt: string, p: Record<string, string>, ev: string) =>
  String(txt)
    .replaceAll("{nome}", p.nome || "")
    .replaceAll("{codigo}", p.codigo || "")
    .replaceAll("{email}", p.email || "")
    .replaceAll("{evento}", ev || "");

const htmlBody = (texto: string) => {
  const safe = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${safe.replace(/\n/g, "<br>")}</div>`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    // valida a chamada: precisa vir com a chave anon/publishable do projeto
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const apikey = req.headers.get("apikey") || "";
    if (anon && auth !== anon && apikey !== anon) return json({ erro: "Não autorizado." }, 401);

    const { evento_id, participante_ids, assunto, corpo, de } = await req.json();
    if (!evento_id || !Array.isArray(participante_ids) || !participante_ids.length || !assunto || !corpo)
      return json({ erro: "Dados incompletos." }, 400);

    const RESEND = Deno.env.get("RESEND_API_KEY");
    const FROM = (de && String(de).trim()) || Deno.env.get("EMAIL_FROM");
    if (!RESEND || !FROM)
      return json({ erro: "Configure RESEND_API_KEY e EMAIL_FROM nos secrets da função." }, 500);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: parts, error } = await sb
      .from("participantes")
      .select("id, nome, email, codigo, situacao")
      .eq("evento_id", evento_id)
      .in("id", participante_ids.slice(0, 1000));
    if (error) return json({ erro: error.message }, 500);

    const { data: ev } = await sb.from("eventos").select("nome").eq("id", evento_id).maybeSingle();
    const nomeEvento = ev?.nome || "";

    const alvos = (parts || []).filter((p) => (p.email || "").includes("@"));
    if (!alvos.length) return json({ enviados: 0, falhas: [], total: 0 });

    let enviados = 0;
    const falhas: { email: string; erro: string }[] = [];

    for (let i = 0; i < alvos.length; i += 100) {
      const bloco = alvos.slice(i, i + 100);
      const lote = bloco.map((p) => ({
        from: FROM,
        to: [p.email],
        subject: preencher(assunto, p, nomeEvento),
        html: htmlBody(preencher(corpo, p, nomeEvento)),
      }));
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote),
      });
      const rj = await r.json().catch(() => ({}));
      if (!r.ok) {
        bloco.forEach((p) => falhas.push({ email: p.email, erro: rj?.message || `HTTP ${r.status}` }));
      } else {
        enviados += Array.isArray(rj?.data) ? rj.data.length : lote.length;
      }
    }

    return json({ enviados, falhas, total: alvos.length });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
