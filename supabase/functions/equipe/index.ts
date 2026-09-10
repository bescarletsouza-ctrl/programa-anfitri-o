// =============================================================================
// Edge Function: equipe
// Cria / lista / remove os logins da equipe de check-in (Supabase Auth).
// Usa a SERVICE_ROLE key (só existe dentro da função) para chamar auth.admin.
//
// Chamada pelo admin com a chave publishable no header — mesma validação das
// outras funções. ATENÇÃO: enquanto o admin não tiver login próprio, qualquer
// pessoa com a chave pública pode criar um login aqui. Endureça isto (checar
// um admin autenticado) quando o Supabase Auth entrar no painel.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const apikey = req.headers.get("apikey") || "";
    if (anon && auth !== anon && apikey !== anon) return json({ erro: "Não autorizado." }, 401);

    const { acao, email, senha, id } = await req.json();
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    if (acao === "listar") {
      const { data, error } = await sb.auth.admin.listUsers({ perPage: 200 });
      if (error) return json({ erro: error.message }, 500);
      const membros = (data.users || [])
        .map((u) => ({ id: u.id, email: u.email, criado: u.created_at, ultimo_login: u.last_sign_in_at }))
        .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return json({ membros });
    }

    if (acao === "criar") {
      const mail = String(email || "").trim().toLowerCase();
      if (!mail || !/^\S+@\S+\.\S+$/.test(mail)) return json({ erro: "E-mail inválido." }, 400);
      if (String(senha || "").length < 6) return json({ erro: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { data, error } = await sb.auth.admin.createUser({
        email: mail, password: String(senha), email_confirm: true,
      });
      if (error) return json({ erro: /already been registered/i.test(error.message) ? "Esse e-mail já tem login." : error.message }, 400);
      return json({ ok: true, id: data.user?.id, email: data.user?.email });
    }

    if (acao === "senha") {
      if (!id) return json({ erro: "id obrigatório." }, 400);
      if (String(senha || "").length < 6) return json({ erro: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { error } = await sb.auth.admin.updateUserById(id, { password: String(senha) });
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true });
    }

    if (acao === "remover") {
      if (!id) return json({ erro: "id obrigatório." }, 400);
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
