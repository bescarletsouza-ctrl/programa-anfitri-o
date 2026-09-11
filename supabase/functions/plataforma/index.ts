// =============================================================================
// Edge Function: plataforma
// Gestão de organizações (clientes) e seus admins. Só a super-admin usa.
// Usa a SERVICE_ROLE key (auth.admin + escrita nas tabelas de plataforma).
//
// Auth: o admin chama autenticado; a função lê o JWT do header Authorization,
// resolve o user e exige que ele esteja em plataforma_admins (menos "status" e
// "bootstrap"). "bootstrap" só roda uma vez e só para o e-mail da dona.
//
// Deploy:  supabase functions deploy plataforma
// Secrets (opcionais — se faltarem, o link de convite volta na resposta para
// copiar à mão):  RESEND_API_KEY, EMAIL_FROM
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "bescarletsouza@gmail.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SITE = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
const redirectTo = () => (SITE ? `${SITE}/login.html?definir=1` : undefined);

const svc = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// manda o link de convite/definição de senha por e-mail (Resend). Se não houver
// secret, devolve o link para a dona repassar manualmente.
async function mandarConvite(email: string, link: string, nomeOrg?: string) {
  const KEY = Deno.env.get("RESEND_API_KEY");
  const FROM = Deno.env.get("EMAIL_FROM");
  if (!KEY || !FROM) return { enviado: false, link };
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
    <p>Você recebeu acesso ${nomeOrg ? `à organização <b>${nomeOrg}</b> ` : ""}no <b>We.events</b>.</p>
    <p><a href="${link}" style="background:#ea580c;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Criar minha senha e entrar</a></p>
    <p style="color:#666;font-size:13px">Ou copie: ${link}</p>
  </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: "Seu acesso ao We.events", html }),
  });
  return { enviado: r.ok, link };
}

// cria (ou acha) o auth user e gera um link de convite/magiclink
async function convidar(sb: ReturnType<typeof svc>, email: string) {
  const mail = email.trim().toLowerCase();
  let { data, error } = await sb.auth.admin.generateLink({
    type: "invite", email: mail, options: { redirectTo: redirectTo() },
  });
  if (error && /already been registered|already exists/i.test(error.message)) {
    ({ data, error } = await sb.auth.admin.generateLink({
      type: "magiclink", email: mail, options: { redirectTo: redirectTo() },
    }));
  }
  if (error) throw new Error(error.message);
  return { userId: data.user?.id as string, link: data.properties?.action_link as string };
}

async function callerAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await anon.auth.getUser(jwt);
  return data.user || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    const body = await req.json();
    const acao = body.acao;
    const sb = svc();

    // ---- status: precisa de bootstrap? (sem auth) --------------------------
    if (acao === "status") {
      const { count } = await sb.from("plataforma_admins").select("user_id", { count: "exact", head: true });
      return json({ needs_bootstrap: (count || 0) === 0 });
    }

    // ---- bootstrap: cria a conta de dona (uma vez só) ----------------------
    if (acao === "bootstrap") {
      const { count } = await sb.from("plataforma_admins").select("user_id", { count: "exact", head: true });
      if ((count || 0) > 0) return json({ erro: "Plataforma já configurada." }, 400);
      const email = String(body.email || "").trim().toLowerCase();
      if (email !== OWNER_EMAIL) return json({ erro: "E-mail não autorizado para configurar a plataforma." }, 403);

      const senha = String(body.senha || "");
      let userId: string, link: string | undefined;
      if (senha.length >= 6) {
        const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
        if (error) return json({ erro: error.message }, 400);
        userId = data.user!.id;
      } else {
        const c = await convidar(sb, email);
        userId = c.userId; link = c.link;
      }
      await sb.from("plataforma_admins").upsert({ user_id: userId, email });
      const { data: org } = await sb.from("organizacoes").select("id").eq("nome", "We.events").maybeSingle();
      if (org) await sb.from("org_membros").upsert(
        { org_id: org.id, user_id: userId, email, papel: "admin" }, { onConflict: "org_id,user_id" });
      if (link) await mandarConvite(email, link, "We.events");
      return json({ ok: true, link: link || null });
    }

    // ---- a partir daqui: só plataforma_admin -----------------------------
    const caller = await callerAdmin(req);
    if (!caller) return json({ erro: "Não autenticado." }, 401);
    const { data: adm } = await sb.from("plataforma_admins").select("user_id").eq("user_id", caller.id).maybeSingle();
    const ehAdminPlataforma = !!adm;

    if (acao === "listar_orgs") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const [{ data: orgs }, { data: membros }, { data: evs }, { data: parts }, { data: cks }, { data: anfs }, { data: convs }] =
        await Promise.all([
          sb.from("organizacoes").select("*").order("criado_em", { ascending: false }),
          sb.from("org_membros").select("org_id, papel, email, nome, id"),
          sb.from("eventos").select("id, org_id"),
          sb.from("participantes").select("evento_id, presente, situacao"),
          sb.from("checkins").select("evento_id, acao"),
          sb.from("anfitrioes").select("evento_id"),
          sb.from("convidados").select("evento_id, status"),
        ]);
      const orgDoEvento = new Map<string, string>();
      (evs || []).forEach((e) => e.org_id && orgDoEvento.set(e.id, e.org_id));
      const zero = () => ({ eventos: 0, membros: 0, participantes: 0, presentes: 0, checkins: 0, anfitrioes: 0, convidados: 0 });
      const agg = new Map<string, ReturnType<typeof zero>>();
      const bump = (orgId: string | undefined, k: keyof ReturnType<typeof zero>, n = 1) => {
        if (!orgId) return; if (!agg.has(orgId)) agg.set(orgId, zero());
        (agg.get(orgId)![k] as number) += n;
      };
      (evs || []).forEach((e) => bump(e.org_id, "eventos"));
      (membros || []).forEach((m) => bump(m.org_id, "membros"));
      (parts || []).forEach((p) => { const o = orgDoEvento.get(p.evento_id); bump(o, "participantes"); if (p.presente) bump(o, "presentes"); });
      (cks || []).forEach((c) => { if (c.acao === "entrada") bump(orgDoEvento.get(c.evento_id), "checkins"); });
      (anfs || []).forEach((a) => bump(orgDoEvento.get(a.evento_id), "anfitrioes"));
      (convs || []).forEach((c) => bump(orgDoEvento.get(c.evento_id), "convidados"));
      return json({
        orgs: (orgs || []).map((o) => {
          const a = agg.get(o.id) || zero();
          return {
            ...o,
            membros: a.membros, eventos_usados: a.eventos,
            participantes: a.participantes, presentes: a.presentes,
            checkins: a.checkins, anfitrioes: a.anfitrioes, convidados: a.convidados,
            equipe: (membros || []).filter((m) => m.org_id === o.id),
          };
        }),
      });
    }

    if (acao === "uso_eventos") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const [{ data: orgs }, { data: evs }, { data: parts }, { data: cks }] = await Promise.all([
        sb.from("organizacoes").select("id, nome"),
        sb.from("eventos").select("id, nome, data_evento, org_id, created_at"),
        sb.from("participantes").select("evento_id, presente"),
        sb.from("checkins").select("evento_id, acao"),
      ]);
      const nomeOrg = new Map((orgs || []).map((o) => [o.id, o.nome]));
      const pPorEv = new Map<string, { t: number; p: number }>();
      (parts || []).forEach((p) => {
        const v = pPorEv.get(p.evento_id) || { t: 0, p: 0 };
        v.t++; if (p.presente) v.p++; pPorEv.set(p.evento_id, v);
      });
      const ckPorEv = new Map<string, number>();
      (cks || []).forEach((c) => { if (c.acao === "entrada") ckPorEv.set(c.evento_id, (ckPorEv.get(c.evento_id) || 0) + 1); });
      return json({
        eventos: (evs || []).map((e) => ({
          org: nomeOrg.get(e.org_id) || "—",
          nome: e.nome, data: e.data_evento || e.created_at?.slice(0, 10),
          participantes: pPorEv.get(e.id)?.t || 0,
          presentes: pPorEv.get(e.id)?.p || 0,
          checkins: ckPorEv.get(e.id) || 0,
        })).sort((a, b) => (b.data || "").localeCompare(a.data || "")),
      });
    }

    if (acao === "reenviar_convite") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const { data: m } = await sb.from("org_membros").select("email")
        .eq("org_id", body.org_id).eq("papel", "admin").order("criado_em").limit(1).maybeSingle();
      const email = (body.email || m?.email || "").trim().toLowerCase();
      if (!email) return json({ erro: "Organização sem responsável cadastrado." }, 400);
      const c = await convidar(sb, email);
      const { data: org } = await sb.from("organizacoes").select("nome").eq("id", body.org_id).maybeSingle();
      const env = await mandarConvite(email, c.link, org?.nome);
      return json({ ok: true, email, convite: env });
    }

    if (acao === "criar_org") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const b = body;
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ erro: "E-mail do responsável inválido." }, 400);
      if (!String(b.nome || b.empresa || "").trim()) return json({ erro: "Nome da empresa é obrigatório." }, 400);
      const { data: org, error } = await sb.from("organizacoes").insert({
        nome: String(b.nome || b.empresa).trim(),
        empresa: b.empresa || null, ramo: b.ramo || null, faturamento: b.faturamento || null,
        telefone: b.telefone || null, email,
        acesso: ["tudo", "eventos", "anfitrioes"].includes(b.acesso) ? b.acesso : "tudo",
        max_eventos: b.max_eventos ? Number(b.max_eventos) : null,
        expira_em: b.expira_em || null,
      }).select().single();
      if (error) return json({ erro: error.message }, 400);
      const c = await convidar(sb, email);
      await sb.from("org_membros").upsert({
        org_id: org.id, user_id: c.userId, email,
        nome: b.responsavel_nome || null, telefone: b.telefone || null, papel: "admin",
      }, { onConflict: "org_id,user_id" });
      const env = await mandarConvite(email, c.link, org.nome);
      return json({ ok: true, org, convite: env });
    }

    if (acao === "editar_org") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const patch: Record<string, unknown> = {};
      for (const k of ["nome", "empresa", "ramo", "faturamento", "telefone", "email", "acesso", "ativo"])
        if (k in body) patch[k] = body[k];
      if ("max_eventos" in body) patch.max_eventos = body.max_eventos ? Number(body.max_eventos) : null;
      if ("expira_em" in body) patch.expira_em = body.expira_em || null;
      const { data, error } = await sb.from("organizacoes").update(patch).eq("id", body.id).select().single();
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true, org: data });
    }

    if (acao === "remover_org") {
      if (!ehAdminPlataforma) return json({ erro: "Sem permissão." }, 403);
      const { error } = await sb.from("organizacoes").delete().eq("id", body.id);
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true });
    }

    if (acao === "add_membro") {
      const orgId = body.org_id;
      const ok = ehAdminPlataforma || await ehAdminDaOrg(sb, caller.id, orgId);
      if (!ok) return json({ erro: "Sem permissão." }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ erro: "E-mail inválido." }, 400);
      const c = await convidar(sb, email);
      const { error } = await sb.from("org_membros").upsert({
        org_id: orgId, user_id: c.userId, email,
        nome: body.nome || null, telefone: body.telefone || null,
        papel: body.papel === "admin" ? "admin" : "membro",
      }, { onConflict: "org_id,user_id" });
      if (error) return json({ erro: error.message }, 400);
      const env = await mandarConvite(email, c.link);
      return json({ ok: true, convite: env });
    }

    if (acao === "remover_membro") {
      const { data: m } = await sb.from("org_membros").select("*").eq("id", body.id).maybeSingle();
      if (!m) return json({ erro: "Membro não encontrado." }, 404);
      const ok = ehAdminPlataforma || await ehAdminDaOrg(sb, caller.id, m.org_id);
      if (!ok) return json({ erro: "Sem permissão." }, 403);
      await sb.from("org_membros").delete().eq("id", body.id);
      const { count } = await sb.from("org_membros").select("id", { count: "exact", head: true }).eq("user_id", m.user_id);
      if ((count || 0) === 0) await sb.auth.admin.deleteUser(m.user_id).catch(() => {});
      return json({ ok: true });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});

async function ehAdminDaOrg(sb: ReturnType<typeof svc>, userId: string, orgId: string) {
  const { data } = await sb.from("org_membros").select("id")
    .eq("org_id", orgId).eq("user_id", userId).eq("papel", "admin").maybeSingle();
  return !!data;
}
