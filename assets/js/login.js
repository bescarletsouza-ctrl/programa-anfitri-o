// =============================================================================
// Tela de login do painel. Também trata:
//  - link de convite / redefinição de senha (Supabase manda com #type=invite|recovery)
//  - bootstrap: se ninguém é dono da plataforma ainda, oferece criar a conta.
// =============================================================================
import { supabase } from "./supabase.js";
import { plataformaStatus, bootstrapPlataforma } from "./supabase.js";

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const NEXT = params.get("next") || "/admin/index.html";

let modo = "login"; // "login" | "definir-senha" | "bootstrap"

const erro = (msg) => { el("erro").hidden = !msg; el("erro").textContent = msg || ""; };

el("form-login").addEventListener("submit", enviar);

boot();

async function boot() {
  // Fluxo de convite/recuperação: o link do Supabase chega ou com
  // #type=invite|recovery (fluxo implícito) ou como ?code= + ?definir=1 que a
  // gente adiciona no redirectTo (fluxo PKCE, que não traz o "type").
  const hash = location.hash || "";
  const ehRecuperacao = /type=(invite|recovery)/.test(hash) || params.get("definir") === "1";

  // dá um tempinho pro supabase-js trocar o ?code= por sessão (detectSessionInUrl)
  let session = null;
  for (let i = 0; i < 8; i++) {
    session = (await supabase.auth.getSession()).data.session;
    if (session || !location.search.includes("code=")) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (session && !ehRecuperacao) return irParaDestino();

  if (ehRecuperacao && session) {
    modo = "definir-senha";
    return mostrarDefinirSenha();
  }
  if (ehRecuperacao && !session) {
    // link expirado / já usado
    erro("Este link de acesso expirou ou já foi usado. Peça um novo convite.");
    return mostrarLogin();
  }

  // 2. precisa de bootstrap?
  try {
    const s = await plataformaStatus();
    if (s?.needs_bootstrap) { modo = "bootstrap"; return mostrarBootstrap(); }
  } catch { /* função não deployada ainda — segue pro login normal */ }

  mostrarLogin();
}

function mostrarLogin() {
  modo = "login";
  el("titulo").textContent = "Entrar";
  el("sub").textContent = "Acesse o painel da sua organização.";
  el("btn").textContent = "Entrar";
  el("email").closest(".campo").hidden = false;
  el("email").disabled = false; el("email").required = true;
  el("wrap-senha").hidden = false;
  el("senha").autocomplete = "current-password";
  el("carregando").hidden = true;
  el("form-login").hidden = false;
}

function mostrarDefinirSenha() {
  el("titulo").textContent = "Defina sua senha";
  el("sub").textContent = "Escolha uma senha para acessar o We.events.";
  el("btn").textContent = "Salvar e entrar";
  // esconder um input `required` trava o submit ("not focusable")
  el("email").closest(".campo").hidden = true;
  el("email").disabled = true;
  el("email").required = false;
  el("wrap-senha").hidden = false;
  el("senha").autocomplete = "new-password";
  el("senha").placeholder = "mín. 6 caracteres";
  el("carregando").hidden = true;
  el("form-login").hidden = false;
}

function mostrarBootstrap() {
  el("titulo").textContent = "Configurar a plataforma";
  el("sub").textContent = "Primeiro acesso: crie a conta de dono do We.events.";
  el("btn").textContent = "Criar conta de dono";
  el("wrap-senha").hidden = false;
  el("senha").autocomplete = "new-password";
  el("senha").placeholder = "mín. 6 caracteres";
  el("carregando").hidden = true;
  el("form-login").hidden = false;
}

async function enviar(e) {
  e.preventDefault();
  erro("");
  const btn = el("btn");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Aguarde…";
  try {
    if (modo === "definir-senha") {
      const { error } = await supabase.auth.updateUser({ password: el("senha").value });
      if (error) throw error;
      irParaDestino();
      return;
    }
    if (modo === "bootstrap") {
      const r = await bootstrapPlataforma(el("email").value.trim(), el("senha").value);
      if (r?.link) {
        erro("Conta criada. Enviamos um link por e-mail para você definir a senha.");
        btn.disabled = false; btn.textContent = original;
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: el("email").value.trim(), password: el("senha").value });
      if (error) throw error;
      irParaDestino();
      return;
    }
    // login normal
    const { error } = await supabase.auth.signInWithPassword({
      email: el("email").value.trim(), password: el("senha").value,
    });
    if (error) throw error;
    irParaDestino();
  } catch (err) {
    erro(/Invalid login/i.test(err.message || "") ? "E-mail ou senha incorretos." : (err.message || "Não foi possível entrar."));
    btn.disabled = false; btn.textContent = original;
  }
}

function irParaDestino() {
  const alvo = NEXT.startsWith("/") ? NEXT : "/admin/index.html";
  location.replace(alvo);
}
