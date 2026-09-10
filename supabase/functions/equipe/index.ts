// =============================================================================
// Edge Function: equipe
// Usuários de UMA organização (Supabase Auth + org_membros). O admin da org (ou
// a super-admin) cria/lista/remove os logins da equipe dele. Esses usuários
// entram no /admin e no app de check-in mobile escopados pela organização.
//
// Auth: lê o JWT do header Authorization, resolve o user e exige que ele seja
// plataforma_admin OU admin (papel='admin') da org_id informada.
//
// Deploy:  supabase functions deploy equipe
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SITE = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
const svc = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await anon.auth.getUser(jwt);
  return data.user || null;
}

async function podeGerir(sb: ReturnType<typeof svc>, userId: string, orgId: string) {
  const { data: plat } = await sb.from("plataforma_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (plat) return true;
  const { data: m } = await sb.from("org_membros").select("id")
    .eq("org_id", orgId).eq("user_id", userId).eq("papel", "admin").maybeSingle();
  return !!m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    const { acao, org_id, email, senha, nome, telefone, papel, membro_id } = await req.json();
    if (!org_id) return json({ erro: "org_id obrigatório." }, 400);

    const sb = svc();
    const u = await caller(req);
    if (!u) return json({ erro: "Não autenticado." }, 401);
    if (!(await podeGerir(sb, u.id, org_id))) return json({ erro: "Sem permissão nesta organização." }, 403);

    if (acao === "listar") {
      const { data: membros } = await sb.from("org_membros").select("*").eq("org_id", org_id);
      const ids = (membros || []).map((m) => m.user_id);
      const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const porId = new Map((users?.users || []).map((x) => [x.id, x]));
      return json({
        membros: (membros || [])
          .map((m) => ({
            id: m.id, user_id: m.user_id, email: m.email || porId.get(m.user_id)?.email,
            nome: m.nome, papel: m.papel,
            ultimo_login: porId.get(m.user_id)?.last_sign_in_at || null,
          }))
          .filter((m) => ids.includes(m.user_id))
          .sort((a, b) => (a.email || "").localeCompare(b.email || "")),
      });
    }

    if (acao === "criar") {
      const mail = String(email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(mail)) return json({ erro: "E-mail inválido." }, 400);

      let userId: string, link: string | null = null;
      if (String(senha || "").length >= 6) {
        const { data, error } = await sb.auth.admin.createUser({ email: mail, password: String(senha), email_confirm: true });
        if (error) {
          if (!/already been registered/i.test(error.message)) return json({ erro: error.message }, 400);
          const { data: found } = await sb.auth.admin.listUsers({ perPage: 1000 });
          userId = found?.users.find((x) => x.email === mail)?.id || "";
          if (!userId) return json({ erro: "Não foi possível localizar o usuário." }, 400);
        } else userId = data.user!.id;
      } else {
        const rt = SITE ? `${SITE}/login.html?definir=1` : undefined;
        let g = await sb.auth.admin.generateLink({ type: "invite", email: mail, options: { redirectTo: rt } });
        if (g.error && /already/i.test(g.error.message))
          g = await sb.auth.admin.generateLink({ type: "magiclink", email: mail, options: { redirectTo: rt } });
        if (g.error) return json({ erro: g.error.message }, 400);
        userId = g.data.user!.id;
        link = g.data.properties?.action_link || null;
      }

      const { error: eM } = await sb.from("org_membros").upsert({
        org_id, user_id: userId, email: mail, nome: nome || null, telefone: telefone || null,
        papel: papel === "admin" ? "admin" : "membro",
      }, { onConflict: "org_id,user_id" });
      if (eM) return json({ erro: eM.message }, 400);
      return json({ ok: true, user_id: userId, link });
    }

    if (acao === "senha") {
      if (!membro_id) return json({ erro: "membro_id obrigatório." }, 400);
      if (String(senha || "").length < 6) return json({ erro: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { data: m } = await sb.from("org_membros").select("user_id").eq("id", membro_id).eq("org_id", org_id).maybeSingle();
      if (!m) return json({ erro: "Membro não encontrado." }, 404);
      const { error } = await sb.auth.admin.updateUserById(m.user_id, { password: String(senha) });
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true });
    }

    if (acao === "remover") {
      if (!membro_id) return json({ erro: "membro_id obrigatório." }, 400);
      const { data: m } = await sb.from("org_membros").select("user_id").eq("id", membro_id).eq("org_id", org_id).maybeSingle();
      if (!m) return json({ erro: "Membro não encontrado." }, 404);
      await sb.from("org_membros").delete().eq("id", membro_id);
      const { count } = await sb.from("org_membros").select("id", { count: "exact", head: true }).eq("user_id", m.user_id);
      const { data: plat } = await sb.from("plataforma_admins").select("user_id").eq("user_id", m.user_id).maybeSingle();
      if ((count || 0) === 0 && !plat) await sb.auth.admin.deleteUser(m.user_id).catch(() => {});
      return json({ ok: true });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
