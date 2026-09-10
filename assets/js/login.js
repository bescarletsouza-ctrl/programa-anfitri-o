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
  // 1. já logado? (e não é fluxo de definir senha)
  const hash = location.hash || "";
  const ehRecuperacao = /type=(invite|recovery)/.test(hash);

  const { data: { session } } = await supabase.auth.getSession();

  if (session && !ehRecuperacao) return irParaDestino();

  if (ehRecuperacao || (session && ehRecuperacao)) {
    // supabase-js já trocou o código pela sessão (detectSessionInUrl)
    modo = "definir-senha";
    return mostrarDefinirSenha();
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
  el("wrap-senha").hidden = false;
  el("senha").autocomplete = "current-password";
  el("carregando").hidden = true;
  el("form-login").hidden = false;
}

function mostrarDefinirSenha() {
  el("titulo").textContent = "Defina sua senha";
  el("sub").textContent = "Escolha uma senha para acessar o We.events.";
  el("btn").textContent = "Salvar e entrar";
  el("email").closest(".campo").hidden = true;
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
