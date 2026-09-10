// =============================================================================
// Edge Function: publico
// Serve APENAS o que as páginas públicas (convite / painel do anfitrião /
// acompanhar inscrição) precisam, por slug/id, usando a service role. Assim o
// `anon` não precisa mais ler o banco direto (0017 revoga tudo do anon).
//
// Deploy:  supabase functions deploy publico
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TEXTOS_EVENTO = [
  "id", "nome", "subtitulo_convite", "texto_confirmacao",
  "texto_em_analise", "texto_aprovado", "texto_recusado",
];

const svc = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

async function anfitriaoPorSlug(sb: ReturnType<typeof svc>, slug: string) {
  const { data } = await sb.from("anfitrioes")
    .select("id, nome, slug, evento_id, grupo_id, vai, grupo:grupos(nome)")
    .eq("slug", slug).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Envie POST." }, 405);

  try {
    const body = await req.json();
    const acao = body.acao;
    const sb = svc();

    if (acao === "convite") {
      const a = await anfitriaoPorSlug(sb, String(body.slug || ""));
      if (!a) return json({ erro: "Link inválido." }, 404);
      const [{ data: perguntas }, { data: evento }] = await Promise.all([
        sb.from("form_perguntas").select("*").eq("evento_id", a.evento_id).eq("ativo", true).order("ordem"),
        sb.from("eventos").select(TEXTOS_EVENTO.join(",")).eq("id", a.evento_id).maybeSingle(),
      ]);
      return json({ anfitriao: a, perguntas: perguntas || [], evento: evento || null });
    }

    if (acao === "enviar_convite") {
      const a = await anfitriaoPorSlug(sb, String(body.slug || ""));
      if (!a) return json({ erro: "Link inválido." }, 404);
      const reg = { ...(body.registro || {}) };
      // o servidor manda em evento_id / anfitriao_id — o cliente não decide
      reg.evento_id = a.evento_id;
      reg.anfitriao_id = a.id;
      delete reg.id;
      delete reg.status; reg.status = "Pendente";
      const { data, error } = await sb.from("convidados").insert(reg).select("id").single();
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true, id: data.id });
    }

    if (acao === "painel") {
      const a = await anfitriaoPorSlug(sb, String(body.slug || ""));
      if (!a) return json({ erro: "Link inválido." }, 404);
      const [{ data: convites }, { data: marcos }, { data: ranking }] = await Promise.all([
        sb.from("convidados").select("id, nome, status, created_at").eq("anfitriao_id", a.id).order("created_at", { ascending: false }),
        sb.from("marcos").select("*").eq("evento_id", a.evento_id).order("quantidade"),
        sb.from("ranking_publico").select("*").eq("evento_id", a.evento_id).order("confirmados", { ascending: false }),
      ]);
      return json({ anfitriao: a, convites: convites || [], marcos: marcos || [], ranking: ranking || [] });
    }

    if (acao === "status") {
      const { data: c } = await sb.from("convidados")
        .select("id, nome, status, created_at, evento_id, anfitriao:anfitrioes(nome)")
        .eq("id", String(body.c || "")).maybeSingle();
      if (!c) return json({ erro: "Inscrição não encontrada." }, 404);
      const { data: evento } = await sb.from("eventos").select(TEXTOS_EVENTO.join(",")).eq("id", c.evento_id).maybeSingle();
      return json({ convidado: c, evento: evento || null });
    }

    if (acao === "status_email") {
      const email = String(body.email || "").trim();
      if (!email) return json({ erro: "Informe o e-mail." }, 400);
      const { data: cs } = await sb.from("convidados")
        .select("id, nome, status, created_at, evento_id, anfitriao:anfitrioes(nome)")
        .ilike("email", email).order("created_at", { ascending: false });
      const ids = [...new Set((cs || []).map((c) => c.evento_id))];
      const eventos: Record<string, unknown> = {};
      if (ids.length) {
        const { data: evs } = await sb.from("eventos").select(TEXTOS_EVENTO.join(",")).in("id", ids);
        (evs || []).forEach((e: Record<string, unknown>) => { eventos[e.id as string] = e; });
      }
      return json({ convidados: cs || [], eventos });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
